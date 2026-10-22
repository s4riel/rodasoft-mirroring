import { Injectable, NotFoundException } from '@nestjs/common';
import {
  clampPage,
  clampPageSize,
  compareEquivalents,
  type EquivalenceComparable,
  type EquivalenceKind,
  type ProductEquivalentItem,
  type ProductEquivalentsResponse,
} from '@rodasoft/domain';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ListEquivalentsQueryDto } from './dto';

const KIND_ORDER: Record<EquivalenceKind, number> = { EXACT: 0, WITH_DIFFERENCES: 1, INCOMPATIBLE: 2 };

const countrySelect = { select: { id: true, code: true, name: true } } as const;
const productInclude = {
  brand: { select: { id: true, name: true, logoUrl: true, country: countrySelect } },
  country: countrySelect,
  dimensions: { select: { innerDiameter: true, outerDiameter: true, width: true } },
} as const;

/**
 * Read side of the equivalences (HU-INV-04). Links are direct pairs stored once; whether a link is exact or has
 * differences is computed here from the products, never stored. Creating links is HU-INV-13.
 * Never exposes `cost`. Read-only: no audit and no outbox.
 */
@Injectable()
export class EquivalencesService {
  constructor(private readonly prisma: PrismaService) {}

  async listForProduct(id: string, query: ListEquivalentsQueryDto): Promise<ProductEquivalentsResponse> {
    const page = clampPage(query.page);
    const pageSize = clampPageSize(query.pageSize);

    const source = await this.prisma.tenant.product.findFirst({ where: { id }, include: { ...productInclude, category: { select: { id: true, parentId: true } } } });
    if (!source) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });

    const links = await this.prisma.tenant.equivalence.findMany({
      where: { OR: [{ productAId: id }, { productBId: id }] },
      select: { productAId: true, productBId: true },
    });
    const otherIds = links.map((l) => (l.productAId === id ? l.productBId : l.productAId));

    const [others, labels, stock] = await Promise.all([
      this.prisma.tenant.product.findMany({ where: { id: { in: otherIds } }, include: productInclude }),
      this.labelsOf(source.category.id, source.category.parentId),
      this.prisma.tenant.stockLevel.groupBy({
        by: ['productId'],
        where: { productId: { in: [id, ...otherIds] } },
        _sum: { quantity: true },
      }),
    ]);
    const stockOf = new Map(stock.map((s) => [s.productId, s._sum.quantity ?? 0]));

    const sourceComparable = toComparable(source);
    // an equivalent shares the original's type only when its leaf category matches, which `compareEquivalents` checks
    const toItem = (p: (typeof others)[number], kind: EquivalenceKind, differences: ProductEquivalentItem['differences']): ProductEquivalentItem => ({
      productId: p.id,
      manufacturerCode: p.manufacturerCode,
      brand: { id: p.brand.id, name: p.brand.name, logoUrl: p.brand.logoUrl },
      country: p.country ?? p.brand.country,
      totalStock: stockOf.get(p.id) ?? 0,
      salePrice: p.salePrice.toFixed(2),
      status: p.status,
      kind,
      differences,
    });

    const all = others
      .map((p) => {
        const { kind, differences } = compareEquivalents(sourceComparable, toComparable(p), labels);
        return toItem(p, kind, differences);
      })
      .sort(
        (a, b) =>
          KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
          a.brand.name.localeCompare(b.brand.name) ||
          a.manufacturerCode.localeCompare(b.manufacturerCode) ||
          // the code is unique per brand, not overall: the id keeps the pages stable
          a.productId.localeCompare(b.productId),
      );

    const sourceItem = toItem(source, 'EXACT', []);
    return {
      source: sourceItem,
      items: all.slice((page - 1) * pageSize, page * pageSize),
      total: all.length,
      page,
      pageSize,
      summary: {
        brandCount: new Set(all.map((i) => i.brand.id)).size,
        exact: all.filter((i) => i.kind === 'EXACT').length,
        withDifferences: all.filter((i) => i.kind === 'WITH_DIFFERENCES').length,
        incompatible: all.filter((i) => i.kind === 'INCOMPATIBLE').length,
      },
      totals: { codes: all.length + 1, stock: all.reduce((sum, i) => sum + i.totalStock, sourceItem.totalStock) },
    };
  }

  /** Labels of the compared keys: the category's attribute definitions, or its parent's when it has none. */
  private async labelsOf(categoryId: string, parentId: string | null): Promise<Record<string, string>> {
    let defs = await this.prisma.tenant.attributeDefinition.findMany({ where: { categoryId }, select: { key: true, label: true } });
    if (!defs.length && parentId) {
      defs = await this.prisma.tenant.attributeDefinition.findMany({ where: { categoryId: parentId }, select: { key: true, label: true } });
    }
    return Object.fromEntries(defs.map((d) => [d.key, d.label]));
  }
}

function toComparable(p: {
  categoryId: string;
  attributes: unknown;
  dimensions: { innerDiameter: { toString(): string } | null; outerDiameter: { toString(): string } | null; width: { toString(): string } | null } | null;
}): EquivalenceComparable {
  return {
    categoryId: p.categoryId,
    dimensions: p.dimensions
      ? {
          innerDiameter: p.dimensions.innerDiameter?.toString() ?? null,
          outerDiameter: p.dimensions.outerDiameter?.toString() ?? null,
          width: p.dimensions.width?.toString() ?? null,
        }
      : null,
    attributes: p.attributes && typeof p.attributes === 'object' && !Array.isArray(p.attributes) ? (p.attributes as Record<string, unknown>) : {},
  };
}
