import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  clampPage,
  clampPageSize,
  compareEquivalents,
  type EquivalenceComparable,
  type EquivalenceKind,
  type EquivalenceLinkResponse,
  type EquivalenceSuggestion,
  type EquivalenceSuggestionsResponse,
  normalizePair,
  type ProductEquivalentItem,
  type ProductEquivalentsResponse,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../common/audit/audit.service';
import type { AppClsStore } from '../../common/cls';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ListEquivalentsQueryDto } from './dto';
import type { EquivalenceCandidatesDto, LinkEquivalenceDto } from './product-write.dto';

/** Suggestions offered on "Producto creado" (design-notes: 3 suggested equivalents). */
const SUGGESTION_LIMIT = 3;
/** Candidates shown on the equivalences step, before the product exists. */
const CANDIDATE_LIMIT = 10;

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly audit: AuditService,
  ) {}

  /**
   * Products that could be linked to `id` (HU-INV-06, "Producto creado"): same type and d×D×B, active, and not linked
   * yet. Ordered exact first, then by brand and code; at most three.
   */
  async suggestions(id: string): Promise<EquivalenceSuggestionsResponse> {
    const source = await this.prisma.tenant.product.findFirst({
      where: { id },
      include: { dimensions: { select: { innerDiameter: true, outerDiameter: true, width: true } } },
    });
    if (!source) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });

    const links = await this.prisma.tenant.equivalence.findMany({
      where: { OR: [{ productAId: id }, { productBId: id }] },
      select: { productAId: true, productBId: true },
    });
    const linked = links.flatMap((l) => [l.productAId, l.productBId]);
    const category = await this.prisma.tenant.category.findFirst({ where: { id: source.categoryId }, select: { parentId: true } });
    return { items: await this.rank(toComparable(source), [id, ...linked], category?.parentId ?? null, SUGGESTION_LIMIT) };
  }

  /**
   * Candidates for a product that does not exist yet (the equivalences step of the wizard): active products of the same
   * category with the same d×D×B, compared with the attributes typed so far. Exact first; at most ten.
   */
  async candidates(dto: EquivalenceCandidatesDto): Promise<EquivalenceSuggestionsResponse> {
    const category = await this.prisma.tenant.category.findFirst({ where: { id: dto.categoryId }, select: { id: true, parentId: true } });
    if (!category) throw new NotFoundException({ code: 'CATEGORY_NOT_FOUND', message: 'Category not found' });
    const source: EquivalenceComparable = {
      categoryId: category.id,
      dimensions: { innerDiameter: dto.innerDiameter, outerDiameter: dto.outerDiameter, width: dto.width },
      attributes: dto.attributes ?? {},
    };
    return { items: await this.rank(source, [], category.parentId, CANDIDATE_LIMIT) };
  }

  /** The products with the source's category and measures, compared with it and ranked exact first. */
  private async rank(source: EquivalenceComparable, exclude: string[], parentId: string | null, limit: number): Promise<EquivalenceSuggestion[]> {
    const m = source.dimensions;
    if (!m?.innerDiameter || !m.outerDiameter || !m.width) return [];
    const candidates = await this.prisma.tenant.product.findMany({
      where: {
        id: { notIn: exclude },
        status: 'ACTIVE',
        categoryId: source.categoryId,
        dimensions: { is: { innerDiameter: m.innerDiameter, outerDiameter: m.outerDiameter, width: m.width } },
      },
      include: productInclude,
    });
    const labels = await this.labelsOf(source.categoryId, parentId);
    return candidates
      .map((p) => {
        const { kind, differences } = compareEquivalents(source, toComparable(p), labels);
        return { productId: p.id, manufacturerCode: p.manufacturerCode, brand: { id: p.brand.id, name: p.brand.name, logoUrl: p.brand.logoUrl }, kind, differences };
      })
      .filter((c) => c.kind !== 'INCOMPATIBLE')
      .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.brand.name.localeCompare(b.brand.name) || a.manufacturerCode.localeCompare(b.manufacturerCode))
      .slice(0, limit);
  }

  /**
   * Links two products as equivalents (HU-INV-06 and HU-INV-13). The pair is stored in canonical order, so a link made
   * in either direction is the same row.
   */
  async link(dto: LinkEquivalenceDto): Promise<EquivalenceLinkResponse> {
    if (dto.productAId === dto.productBId) {
      throw new UnprocessableEntityException({ code: 'SELF_LINK', message: 'A product cannot be linked to itself' });
    }
    const [productAId, productBId] = normalizePair(dto.productAId, dto.productBId);
    const found = await this.prisma.tenant.product.count({ where: { id: { in: [productAId, productBId] } } });
    if (found !== 2) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });

    try {
      return await this.prisma.tenant.$transaction(async (tx) => {
        const row = await tx.equivalence.create({
          data: { companyId: this.companyId(), productAId, productBId, createdById: this.cls.get('userId') ?? null },
          select: { id: true, productAId: true, productBId: true },
        });
        await this.audit.log(
          { action: 'inventory.equivalence.link', entity: 'Equivalence', entityId: row.id, after: { productAId, productBId } },
          tx as unknown as Prisma.TransactionClient,
        );
        return row;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ code: 'EQUIVALENCE_EXISTS', message: 'The products are already linked' });
      }
      throw err;
    }
  }

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

  private companyId(): string {
    const companyId = this.cls.get('companyId');
    if (!companyId) throw new Error('Missing company in context');
    return companyId;
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
