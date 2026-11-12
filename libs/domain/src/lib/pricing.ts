/**
 * The sale price of a product (HU-VEN-26): one price per product and company (`products.sale_price`), edited from the Precios
 * screen, the inventory form or the Excel import, and every change kept in `price_changes`. Pure rules plus the contracts of the
 * prices API. Money is a decimal string on the wire and `Decimal` in the rules, never `number`.
 */
import { validateOpeningFloat } from './cash-shift';
import { Decimal } from './money';
import type { ProductStatus } from './product-catalog';

/** `price_changes.reason` ("Motivo") limit. */
export const PRICE_REASON_MAX = 300;

/** Where a price change came from. `BULK` is the bulk update of HU-VEN-27. */
export const PRICE_CHANGE_SOURCES = ['MANUAL', 'PRODUCT_FORM', 'IMPORT', 'BULK'] as const;
export type PriceChangeSource = (typeof PRICE_CHANGE_SOURCES)[number];

export const PRICE_PAGE_SIZE_MAX = 100;
export const PRICE_PAGE_SIZE_DEFAULT = 20;

/**
 * A price as typed (`255,00`, `1.250,50`) or as the API sends it (`255.00`): zero or more, at most 2 decimals, within the
 * `Decimal(14,2)` column. Null when it is not one.
 */
export function parsePrice(text: string | null | undefined): Decimal | null {
  const parsed = validateOpeningFloat(text);
  return parsed.ok ? parsed.value : null;
}

export type PriceEditError = 'INVALID_PRICE' | 'PRICE_UNCHANGED';

/** A new price for a product: a valid amount above zero and different from the current one. */
export function validatePriceEdit(current: string, next: string | null | undefined): { ok: true; value: Decimal } | { ok: false; error: PriceEditError } {
  const value = parsePrice(next);
  if (!value || value.isZero()) return { ok: false, error: 'INVALID_PRICE' };
  if (value.eq(Decimal.of(current))) return { ok: false, error: 'PRICE_UNCHANGED' };
  return { ok: true, value };
}

export interface PriceChangeDelta {
  /** New minus old, signed. */
  amount: string;
  /** Percent over the old price with one decimal, signed; null when the old price was zero. */
  percent: string | null;
}

/** How much a price moved, in Bs and in percent of the old price. */
export function priceChangeDelta(oldPrice: string, newPrice: string): PriceChangeDelta {
  const before = Decimal.of(oldPrice);
  const amount = Decimal.of(newPrice).sub(before);
  return {
    amount: amount.toString(),
    percent: before.isZero() ? null : Decimal.of(amount.toString(), 4).mul(100).div(Decimal.of(oldPrice, 4)).round(1).toString(),
  };
}

// ── Contracts ──

export interface PriceChangeEntry {
  id: string;
  at: string;
  /** Null when the user no longer exists. */
  by: { id: string; name: string } | null;
  source: PriceChangeSource;
  oldPrice: string;
  newPrice: string;
  /** Signed percent over the old price; null when it was zero. */
  percent: string | null;
  reason: string | null;
}

/** One row of the price list (Figma VP-11). */
export interface PriceListRow {
  productId: string;
  sku: string;
  manufacturerCode: string;
  name: string;
  brand: { id: string; name: string };
  country: { code: string; name: string } | null;
  photo: string | null;
  status: ProductStatus;
  salePrice: string;
  /** False while `sale_price` is 0: the product has no price yet. */
  hasPrice: boolean;
  /** Units on hand in the branch of the list. */
  branchStock: number;
  /** Null for a product whose price never changed since the history exists. */
  lastChange: PriceChangeEntry | null;
}

export interface PriceListKpis {
  products: number;
  withPrice: number;
  withoutPrice: number;
  /** Price changes since the first day of the month in La Paz. */
  changesThisMonth: number;
  /** Present only with `inventory.costs.view`; null when no product has both a price and a cost. */
  averageMarginPercent?: string | null;
}

export const PRICED_FILTERS = ['with', 'without'] as const;
export type PricedFilter = (typeof PRICED_FILTERS)[number];

/** The query of `GET /sales/prices`. */
export interface PriceListQuery {
  q?: string;
  brandId?: string;
  categoryId?: string;
  priced?: PricedFilter;
  branchId?: string;
  page?: number;
  pageSize?: number;
}

export interface PriceListResponse {
  items: PriceListRow[];
  total: number;
  page: number;
  pageSize: number;
  kpis: PriceListKpis;
  /** The branch whose stock the list shows; null when the caller can see none. */
  branch: { id: string; name: string } | null;
  brands: { id: string; name: string }[];
  categories: { id: string; name: string }[];
}

/** A product for the price dialog (Figma VP-11b). `cost` and the margin only travel with `inventory.costs.view`. */
export interface PriceDetail {
  productId: string;
  sku: string;
  manufacturerCode: string;
  name: string;
  brand: { id: string; name: string };
  salePrice: string;
  cost?: string | null;
  marginPercent?: string | null;
  /** Latest first. */
  changes: PriceChangeEntry[];
}

/** The body of `PATCH /sales/prices/:productId`. */
export interface EditPriceInput {
  /** Decimal string with a dot. */
  newPrice: string;
  /** The price the editor saw: a different stored price answers `PRICE_CHANGED`. */
  expectedPrice: string;
  reason?: string | null;
}
