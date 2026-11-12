import type { Prisma } from '@prisma/client';
import { summarizeSpecs, type SalesLineSpec } from '@rodasoft/domain';
import type { PrismaService, TenantTransaction } from '../../common/prisma/prisma.service';

/**
 * The measures and type of the products on a quote, order or sale line (HU-VEN-36). Add `LINE_SPEC_PRODUCT_SELECT` to the
 * product select of the query, then call `lineSpecsOf` once for all the lines: it loads the attribute definitions of every
 * category involved in a single query.
 */
export const LINE_SPEC_PRODUCT_SELECT = {
  id: true,
  attributes: true,
  dimensions: { select: { innerDiameter: true, outerDiameter: true, width: true } },
  category: { select: { id: true, name: true, parent: { select: { id: true, name: true } } } },
} satisfies Prisma.ProductSelect;

export type LineSpecProduct = Prisma.ProductGetPayload<{ select: typeof LINE_SPEC_PRODUCT_SELECT }>;

type TenantDb = TenantTransaction | PrismaService['tenant'];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Spec per product id. The subcategory's own fields are used, or its parent's when it has none (same rule as the product list). */
export async function lineSpecsOf(db: TenantDb, products: readonly LineSpecProduct[]): Promise<Map<string, SalesLineSpec>> {
  const categoryIds = [...new Set(products.flatMap((p) => [p.category.id, p.category.parent?.id ?? '']).filter(Boolean))];
  const definitions = categoryIds.length
    ? await db.attributeDefinition.findMany({
        where: { categoryId: { in: categoryIds } },
        orderBy: [{ step: 'asc' }, { sortOrder: 'asc' }, { key: 'asc' }],
        select: { categoryId: true, key: true, label: true, type: true, unit: true },
      })
    : [];
  const definitionsOf = (categoryId: string) => definitions.filter((d) => d.categoryId === categoryId);

  return new Map(
    products.map((p) => {
      const parent = p.category.parent;
      const own = definitionsOf(p.category.id);
      const hasMeasures = !!(p.dimensions?.innerDiameter && p.dimensions.outerDiameter && p.dimensions.width);
      const specs = summarizeSpecs(own.length ? own : parent ? definitionsOf(parent.id) : [], isRecord(p.attributes) ? p.attributes : {}, { hasMeasures });
      const spec: SalesLineSpec = {
        measures: p.dimensions
          ? {
              innerDiameter: p.dimensions.innerDiameter?.toString() ?? null,
              outerDiameter: p.dimensions.outerDiameter?.toString() ?? null,
              width: p.dimensions.width?.toString() ?? null,
            }
          : null,
        category: parent ? parent.name : p.category.name,
        subcategory: parent ? p.category.name : null,
        details: specs.map((s) => `${s.label}: ${s.value}`),
      };
      return [p.id, spec] as const;
    }),
  );
}
