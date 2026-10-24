import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  buildEquivalenceComparison,
  clampPage,
  clampPageSize,
  compareEquivalents,
  EQUIVALENCE_COMPARE_MAX,
  EQUIVALENCE_COMPARE_MIN,
  type EquivalenceComparable,
  type EquivalenceCompareDefinition,
  type EquivalenceComparisonResponse,
  type EquivalenceKind,
  type EquivalenceLinkResponse,
  type EquivalenceListItem,
  type EquivalenceListProduct,
  type EquivalenceListResponse,
  type EquivalenceSuggestion,
  type EquivalenceSuggestionsResponse,
  isTaperedCategory,
  normalizePair,
  type ProductEquivalentItem,
  type ProductEquivalentsResponse,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../common/audit/audit.service';
import type { AppClsStore } from '../../common/cls';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ListEquivalencesQueryDto, ListEquivalentsQueryDto } from './dto';
import type { EquivalenceCandidatesDto, LinkEquivalenceDto } from './product-write.dto';

/** Suggestions offered on "Producto creado" (design-notes: 3 suggested equivalents). */
const SUGGESTION_LIMIT = 3;
/** Candidates shown on the equivalences step, before the product exists. */
const CANDIDATE_LIMIT = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const KIND_ORDER: Record<EquivalenceKind, number> = { EXACT: 0, WITH_DIFFERENCES: 1, INCOMPATIBLE: 2 };

const countrySelect = { select: { id: true, code: true, name: true } } as const;
const productInclude = {
  brand: { select: { id: true, name: true, logoUrl: true, country: countrySelect } },
  country: countrySelect,
  dimensions: { select: { innerDiameter: true, outerDiameter: true, width: true } },
} as const;

const listProductInclude = {
  ...productInclude,
  category: { select: { id: true, parentId: true, icon: true, parent: { select: { icon: true } } } },
} as const;
const listInclude = {
  productA: { include: listProductInclude },
  productB: { include: listProductInclude },
  createdBy: { select: { id: true, name: true } },
} as const;

const leanSide = {
  select: {
    categoryId: true,
    attributes: true,
    dimensions: { select: { innerDiameter: true, outerDiameter: true, width: true } },
    category: { select: { id: true, parentId: true } },
  },
} as const;
const leanSelect = { id: true, productA: leanSide, productB: leanSide } as const;
type LeanSide = Prisma.ProductGetPayload<typeof leanSide>;

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

  /**
   * The company-wide table of links (HU-INV-11): each pair once, newest first, with both products and the kind computed
   * from them. Without a `kind` filter the page is cut in SQL and only its rows are compared; with one, the links that
   * pass the other filters are compared first, because the kind is never stored.
   */
  async list(query: ListEquivalencesQueryDto): Promise<EquivalenceListResponse> {
    const page = clampPage(query.page);
    const pageSize = clampPageSize(query.pageSize);
    const where = buildListWhere(query);
    const orderBy = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];
    const labelCache = new Map<string, Record<string, string>>();
    const compare = async (a: ListRow['productA'] | LeanSide, b: ListRow['productB'] | LeanSide) => {
      const category = a.category;
      let labels = labelCache.get(category.id);
      if (!labels) {
        labels = await this.labelsOf(category.id, category.parentId);
        labelCache.set(category.id, labels);
      }
      return compareEquivalents(toComparable(a), toComparable(b), labels);
    };

    let rows: { row: ListRow; kind: EquivalenceKind; differences: EquivalenceListItem['differences'] }[];
    let total: number;
    if (query.kind) {
      // the kind is never stored: compare every link that passes the other filters, but on lean rows (only what the
      // comparison reads); the full rows are loaded for the page alone
      const lean = await this.prisma.tenant.equivalence.findMany({ where, orderBy, select: leanSelect });
      const compared = await Promise.all(lean.map(async (l) => ({ id: l.id, ...(await compare(l.productA, l.productB)) })));
      const matching = compared.filter((c) => c.kind === query.kind);
      total = matching.length;
      const pageOf = matching.slice((page - 1) * pageSize, page * pageSize);
      const full = pageOf.length
        ? await this.prisma.tenant.equivalence.findMany({ where: { id: { in: pageOf.map((m) => m.id) } }, include: listInclude })
        : [];
      const byId = new Map(full.map((r) => [r.id, r]));
      rows = pageOf.flatMap((m) => {
        const row = byId.get(m.id);
        return row ? [{ row, kind: m.kind, differences: m.differences }] : [];
      });
    } else {
      const [found, count] = await Promise.all([
        this.prisma.tenant.equivalence.findMany({ where, orderBy, include: listInclude, skip: (page - 1) * pageSize, take: pageSize }),
        this.prisma.tenant.equivalence.count({ where }),
      ]);
      total = count;
      rows = await Promise.all(found.map(async (row) => ({ row, ...(await compare(row.productA, row.productB)) })));
    }

    const stock = rows.length
      ? await this.prisma.tenant.stockLevel.groupBy({
          by: ['productId'],
          where: { productId: { in: rows.flatMap(({ row }) => [row.productAId, row.productBId]) } },
          _sum: { quantity: true },
        })
      : [];
    const stockOf = new Map(stock.map((s) => [s.productId, s._sum.quantity ?? 0]));

    const items = rows.map(
      ({ row, kind, differences }): EquivalenceListItem => ({
        id: row.id,
        productA: toListProduct(row.productA, stockOf),
        productB: toListProduct(row.productB, stockOf),
        kind,
        differences,
        createdBy: row.createdBy,
        createdAt: row.createdAt.toISOString(),
      }),
    );
    // told apart from "no result for these filters": the screen shows another empty state
    const linksEmpty = total === 0 && (await this.prisma.tenant.equivalence.count()) === 0;
    return { items, total, page, pageSize, linksEmpty };
  }

  /**
   * Side-by-side comparison of 2 to 4 products (HU-INV-12, IN-13), in the order requested; the first one is the
   * reference. The products need not be linked to each other. Reads only; never exposes `cost`.
   */
  async compare(rawIds: string): Promise<EquivalenceComparisonResponse> {
    const ids = rawIds.split(',').map((id) => id.trim().toLowerCase());
    const invalid = (message: string) => new BadRequestException({ code: 'COMPARE_INVALID_SELECTION', message, details: { min: EQUIVALENCE_COMPARE_MIN, max: EQUIVALENCE_COMPARE_MAX } });
    if (ids.length < EQUIVALENCE_COMPARE_MIN || ids.length > EQUIVALENCE_COMPARE_MAX) {
      throw invalid(`Select between ${EQUIVALENCE_COMPARE_MIN} and ${EQUIVALENCE_COMPARE_MAX} products`);
    }
    if (new Set(ids).size !== ids.length) throw invalid('A product can be compared only once');
    if (!ids.every((id) => UUID.test(id))) throw invalid('Invalid product id');

    const found = await this.prisma.tenant.product.findMany({
      where: { id: { in: ids } },
      include: { ...productInclude, category: { select: { id: true, name: true, parentId: true, icon: true, parent: { select: { icon: true } } } } },
    });
    if (found.length !== ids.length) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });
    const byId = new Map(found.map((p) => [p.id, p]));
    const products = ids.flatMap((id) => byId.get(id) ?? []);
    if (products.length !== ids.length) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });

    const [stock, definitions] = await Promise.all([
      this.prisma.tenant.stockLevel.groupBy({ by: ['productId'], where: { productId: { in: ids } }, _sum: { quantity: true } }),
      this.definitionsOf(products.map((p) => p.category)),
    ]);
    const stockOf = new Map(stock.map((s) => [s.productId, s._sum.quantity ?? 0]));

    const grid = buildEquivalenceComparison(
      products.map((p) => ({
        ...toComparable(p),
        productId: p.id,
        tapered: isTaperedCategory(p.category.name),
        country: (p.country ?? p.brand.country)?.name ?? null,
      })),
      definitions,
    );
    return {
      columns: grid.columns.map((verdict, i) => {
        const p = products[i];
        const photos = Array.isArray(p.photos) ? (p.photos as string[]) : [];
        return {
          ...verdict,
          manufacturerCode: p.manufacturerCode,
          brand: { id: p.brand.id, name: p.brand.name, logoUrl: p.brand.logoUrl },
          country: p.country ?? p.brand.country,
          photoUrl: photos[0] ?? null,
          categoryIcon: p.category.parent?.icon ?? p.category.icon,
          totalStock: stockOf.get(p.id) ?? 0,
          salePrice: p.salePrice.toFixed(2),
          status: p.status,
        };
      }),
      rows: grid.rows,
    };
  }

  /** The fields of the categories involved, once each (a category without its own takes its parent's), in definition order. */
  private async definitionsOf(categories: readonly { id: string; parentId: string | null }[]): Promise<EquivalenceCompareDefinition[]> {
    const ids = [...new Set(categories.flatMap((c) => (c.parentId ? [c.id, c.parentId] : [c.id])))];
    const rows = await this.prisma.tenant.attributeDefinition.findMany({
      where: { categoryId: { in: ids } },
      select: { categoryId: true, key: true, label: true, type: true, unit: true },
      orderBy: [{ step: 'asc' }, { sortOrder: 'asc' }, { key: 'asc' }],
    });
    const byCategory = new Map<string, typeof rows>();
    for (const r of rows) byCategory.set(r.categoryId, [...(byCategory.get(r.categoryId) ?? []), r]);
    const merged = new Map<string, EquivalenceCompareDefinition>();
    for (const c of categories) {
      const own = byCategory.get(c.id) ?? (c.parentId ? byCategory.get(c.parentId) : undefined) ?? [];
      for (const d of own) if (!merged.has(d.key)) merged.set(d.key, { key: d.key, label: d.label, type: d.type, unit: d.unit });
    }
    return [...merged.values()];
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

type ListRow = Prisma.EquivalenceGetPayload<{ include: typeof listInclude }>;

/** A link matches a filter when either of its sides does. */
function buildListWhere(q: ListEquivalencesQueryDto): Prisma.EquivalenceWhereInput {
  const eitherSide = (side: Prisma.ProductWhereInput): Prisma.EquivalenceWhereInput => ({ OR: [{ productA: side }, { productB: side }] });
  const and: Prisma.EquivalenceWhereInput[] = [];
  if (q.brandId) and.push(eitherSide({ brandId: q.brandId }));
  // a root category also matches the products of its subcategories
  if (q.categoryId) and.push(eitherSide({ OR: [{ categoryId: q.categoryId }, { category: { parentId: q.categoryId } }] }));
  const text = q.q?.trim();
  if (text) and.push(eitherSide({ manufacturerCode: { contains: text, mode: 'insensitive' } }));
  return and.length ? { AND: and } : {};
}

function toListProduct(p: ListRow['productA'], stockOf: ReadonlyMap<string, number>): EquivalenceListProduct {
  const photos = Array.isArray(p.photos) ? (p.photos as string[]) : [];
  return {
    id: p.id,
    manufacturerCode: p.manufacturerCode,
    brand: { id: p.brand.id, name: p.brand.name, logoUrl: p.brand.logoUrl },
    country: p.country ?? p.brand.country,
    photoUrl: photos[0] ?? null,
    categoryIcon: p.category.parent?.icon ?? p.category.icon,
    dimensions: toComparable(p).dimensions,
    totalStock: stockOf.get(p.id) ?? 0,
    status: p.status,
  };
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
