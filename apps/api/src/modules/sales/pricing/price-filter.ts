import type { Prisma } from '@prisma/client';

/** A draft of the creation wizard is not a product yet: it has no place in the price list or in a bulk update. */
export const LISTED: Prisma.ProductWhereInput = { status: { not: 'DRAFT' } };

/** A category filter also matches the products of its subcategories. */
export function categoryFilter(categoryId: string): Prisma.ProductWhereInput {
  return { OR: [{ categoryId }, { category: { parentId: categoryId } }] };
}

/**
 * The brand and category conditions shared by the price list (VP-11) and the bulk update (VP-11c), so the products a user sees
 * when filtering are the ones the bulk update would change.
 */
export function brandCategoryFilters(filter: { brandId?: string; categoryId?: string }): Prisma.ProductWhereInput[] {
  const filters: Prisma.ProductWhereInput[] = [];
  if (filter.brandId) filters.push({ brandId: filter.brandId });
  if (filter.categoryId) filters.push(categoryFilter(filter.categoryId));
  return filters;
}
