import type { Prisma } from '@prisma/client';
import { parseMeasurement } from '@rodasoft/domain';

/**
 * Where-conditions of the "type a code, a measurement or a brand" product search. The exact code is its own query: with a
 * short text many products match by name or brand, and the one typed in full must not be cut before it is ranked (Enter
 * adds the first result). Used by the POS (HU-VEN-02); transfers and adjustments still keep their own copy.
 */
export function productSearchWhere(search: string): { exact: Prisma.ProductWhereInput; matching: Prisma.ProductWhereInput } {
  const measurement = parseMeasurement(search);
  return {
    exact: {
      OR: [{ manufacturerCode: { equals: search, mode: 'insensitive' } }, { sku: { equals: search, mode: 'insensitive' } }],
    },
    matching: {
      OR: [
        { manufacturerCode: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { brand: { name: { contains: search, mode: 'insensitive' } } },
        ...(measurement ? [{ dimensions: { is: measurement } }] : []),
      ],
    },
  };
}

/** 0 for the exact code, 1 for a code that starts with the text, 2 for the rest. */
export function codeRank(code: string, search: string): number {
  const c = code.toLowerCase();
  const s = search.toLowerCase();
  return c === s ? 0 : c.startsWith(s) ? 1 : 2;
}
