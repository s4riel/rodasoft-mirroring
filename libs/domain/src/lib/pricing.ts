/**
 * The sale price of a product (HU-VEN-26): one price per product and company (`products.sale_price`), edited from the Precios
 * screen, the inventory form or the Excel import, and every change kept in `price_changes`. Pure rules plus the contracts of the
 * prices API. Money is a decimal string on the wire and `Decimal` in the rules, never `number`.
 */
import { validateOpeningFloat } from './cash-shift';
import { Decimal } from './money';
import type { ProductStatus } from './product-catalog';
import { ROUNDING_MODES, roundSaleTotal, type RoundingMode } from './sales-pricing';

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

// ── Bulk update (HU-VEN-27, decision #19) ──

export const BULK_PRICE_DIRECTIONS = ['INCREASE', 'DECREASE'] as const;
export type BulkPriceDirection = (typeof BULK_PRICE_DIRECTIONS)[number];

/** Largest increase one bulk update accepts, in percent. A decrease must stay below 100. */
export const BULK_PERCENT_MAX = 1000;
/** Most products one bulk update changes: the apply locks all their rows in one transaction. */
export const BULK_PRICE_MAX_PRODUCTS = 5000;

export type BulkAdjustmentError = 'INVALID_PERCENT' | 'INVALID_DIRECTION' | 'INVALID_ROUNDING';

export interface BulkAdjustment {
  direction: BulkPriceDirection;
  /** Above zero, at most 2 decimals. */
  percent: Decimal;
  rounding: RoundingMode;
}

const PERCENT_TEXT = /^\d{1,4}(?:[.,]\d{1,2})?$/;

/** The direction, percent and rounding of a bulk update as typed or sent by the API. */
export function validateBulkAdjustment(input: {
  direction: string | null | undefined;
  percent: string | null | undefined;
  rounding: string | null | undefined;
}): { ok: true; value: BulkAdjustment } | { ok: false; error: BulkAdjustmentError } {
  const direction = BULK_PRICE_DIRECTIONS.find((d) => d === input.direction);
  if (!direction) return { ok: false, error: 'INVALID_DIRECTION' };
  const rounding = ROUNDING_MODES.find((m) => m === input.rounding);
  if (!rounding) return { ok: false, error: 'INVALID_ROUNDING' };
  const text = (input.percent ?? '').trim();
  if (!PERCENT_TEXT.test(text)) return { ok: false, error: 'INVALID_PERCENT' };
  const percent = Decimal.of(text);
  if (percent.isZero()) return { ok: false, error: 'INVALID_PERCENT' };
  const limit = Decimal.of(direction === 'INCREASE' ? BULK_PERCENT_MAX : 100);
  // an increase may reach the limit; a decrease of 100 % would leave the price at zero
  const over = direction === 'INCREASE' ? percent.cmp(limit) > 0 : percent.cmp(limit) >= 0;
  if (over) return { ok: false, error: 'INVALID_PERCENT' };
  return { ok: true, value: { direction, percent, rounding } };
}

export type BulkSkipReason = 'UNCHANGED' | 'INVALID';

/**
 * The new price of one product: the percent of the current price (half up to the cent) added or taken off, then rounded with the
 * mode of the batch. A product without a price, or one the adjustment would take to zero or below, is `INVALID`; one whose price
 * does not move (a small percent lost in the rounding) is `UNCHANGED`. Neither is written.
 */
export function applyBulkAdjustment(price: Decimal | string, adjustment: BulkAdjustment): { newPrice: Decimal } | { skipped: BulkSkipReason } {
  const current = price instanceof Decimal ? price : Decimal.of(price);
  if (current.isZero() || current.isNegative()) return { skipped: 'INVALID' };
  const delta = current.percent(adjustment.percent);
  const moved = adjustment.direction === 'INCREASE' ? current.add(delta) : current.sub(delta);
  const newPrice = roundSaleTotal(moved, adjustment.rounding).total;
  if (newPrice.isZero() || newPrice.isNegative()) return { skipped: 'INVALID' };
  if (newPrice.eq(current)) return { skipped: 'UNCHANGED' };
  return { newPrice };
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

// ── Bulk update contracts ──

/** The body of `POST /sales/prices/bulk/preview`: at least one of brand and category. */
export interface BulkPriceInput {
  brandId?: string;
  categoryId?: string;
  direction: BulkPriceDirection;
  /** Decimal string with a dot, e.g. `"5"` or `"2.50"`. */
  percent: string;
  rounding: RoundingMode;
  page?: number;
  pageSize?: number;
}

/** The body of `POST /sales/prices/bulk/apply`: the preview's input plus the hash of what the user saw. */
export interface BulkPriceApplyInput extends BulkPriceInput {
  previewHash: string;
  reason?: string | null;
}

export type BulkPriceRowStatus = 'CHANGE' | BulkSkipReason;

export interface BulkPricePreviewRow {
  productId: string;
  sku: string;
  manufacturerCode: string;
  name: string;
  brand: { id: string; name: string };
  currentPrice: string;
  /** Null for a row that does not change. */
  newPrice: string | null;
  /** Signed percent over the current price with one decimal; null for a row that does not change. */
  percent: string | null;
  status: BulkPriceRowStatus;
}

export interface BulkPricePreview {
  counts: { matched: number; toChange: number; unchanged: number; invalid: number };
  items: BulkPricePreviewRow[];
  page: number;
  pageSize: number;
  /** Identifies what the preview would write; `apply` refuses a hash that no longer matches. */
  previewHash: string;
  /** `sales.roundingMode`, the chip the screen preselects. */
  defaultRounding: RoundingMode;
  /** `sales.bulkPriceRequiresApproval`: while true, applying is refused. */
  requiresApproval: boolean;
}

export interface BulkPriceResult {
  batchId: string;
  updated: number;
}
