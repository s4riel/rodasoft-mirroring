import { Decimal, MONEY_SCALE } from './money';
import { IdentityDocumentType } from './nit';
import type { CustomerDiscountType } from './sales-pricing';

/**
 * Customers at the POS (HU-VEN-05) and their discount and credit flag (HU-VEN-37, decisions #4, #5 and #53).
 */

/**
 * Invoice data of a sale without a customer (decision #4): NIT 0 and the name "S/N". It is not a `Customer` row: the cart's
 * `customerId` stays null.
 */
export const FINAL_CONSUMER = {
  documentType: IdentityDocumentType.NIT,
  documentNumber: '0',
  complement: null,
  name: 'S/N',
} as const;

export const CUSTOMER_DISCOUNT_TYPES: readonly CustomerDiscountType[] = ['NONE', 'PERCENT', 'AMOUNT'];

const MAX_PERCENT = Decimal.of('100');

/**
 * Whether a discount setting is acceptable: `NONE` carries no value, a percent is above 0 and at most 100, and a fixed amount
 * is positive. The values are decimal strings (money is never a `number`).
 */
export function customerDiscountInputValid(type: CustomerDiscountType, value: string): boolean {
  if (!CUSTOMER_DISCOUNT_TYPES.includes(type)) return false;
  let amount: Decimal;
  try {
    amount = Decimal.of(value);
  } catch {
    return false;
  }
  if (amount.isNegative()) return false;
  if (type === 'NONE') return amount.isZero();
  if (amount.isZero()) return false;
  if (type === 'PERCENT') return amount.cmp(MAX_PERCENT) <= 0;
  return true;
}

/** What a customer's discount is, as data; the ERP turns it into "10 %" or "Bs 15,00 por venta". */
export type CustomerDiscountDescription = { kind: 'NONE' } | { kind: 'PERCENT'; value: string } | { kind: 'AMOUNT'; value: string };

export function describeCustomerDiscount(type: CustomerDiscountType, value: string): CustomerDiscountDescription {
  if (type === 'NONE') return { kind: 'NONE' };
  return { kind: type, value: Decimal.of(value).round(MONEY_SCALE).toString() };
}

// --- API contracts ---

export interface CustomerSummary {
  id: string;
  name: string;
  documentType: number;
  documentNumber: string;
  complement: string | null;
  email: string | null;
  phone: string | null;
  /** Decision #53: credit is a yes/no flag, with no amount limit. */
  creditEnabled: boolean;
  discount: { type: CustomerDiscountType; value: string };
  status: 'ACTIVE' | 'INACTIVE';
}

/** The POS search: the best matches, a few of them. */
export interface CustomerSearchResponse {
  items: CustomerSummary[];
}

export interface CustomerListQuery {
  q?: string;
  /** `ALL` lists the inactive ones too. Defaults to `ACTIVE`. */
  status?: 'ACTIVE' | 'INACTIVE' | 'ALL';
  page?: number;
  pageSize?: number;
}

/** The customer list of Management (HU-VEN-37). */
export interface CustomerListResponse {
  items: CustomerSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/** Quick creation at the POS (`sales.pos.use`): never sets a discount or credit. */
export interface CreatePosCustomerInput {
  name: string;
  documentType: number;
  documentNumber: string;
  complement?: string | null;
  email?: string | null;
  phone?: string | null;
}

/** The full customer form (`sales.customers.manage`, HU-VEN-37). */
export interface SaveCustomerInput extends CreatePosCustomerInput {
  creditEnabled: boolean;
  discountType: CustomerDiscountType;
  /** Decimal string; "0" for `NONE`. */
  discountValue: string;
  status?: 'ACTIVE' | 'INACTIVE';
}

export type UpdateCustomerInput = Partial<SaveCustomerInput>;

/** `PUT /sales/pos/checkout/customer`: `null` invoices a final consumer. */
export interface SetPosCustomerInput {
  customerId: string | null;
}

/** The tax data the invoice will carry, after validation (`GET /sales/pos/checkout/invoice-data`). */
export interface PosInvoiceDataResponse {
  name: string;
  documentType: number;
  documentNumber: string;
  complement: string | null;
  finalConsumer: boolean;
}
