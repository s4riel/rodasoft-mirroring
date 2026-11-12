/**
 * Selling on credit (HU-VEN-34, decision #53): credit is a yes/no flag on the customer with no amount limit. The sale needs
 * an identified customer with a NIT; the cashier picks a term in days and the due date is a La Paz calendar day.
 */
import { IdentityDocumentType } from './nit';
import { addDaysToDay } from './sales-documents';

/** Longest term a credit sale may carry: a year. */
export const CREDIT_MAX_TERM_DAYS = 365;

export type CreditIneligibleReason = 'CUSTOMER_REQUIRED' | 'CREDIT_NOT_ENABLED' | 'NIT_REQUIRED';

export type CreditEligibility = { ok: true } | { ok: false; reason: CreditIneligibleReason };

/** The part of a customer that decides whether credit may be offered. */
export interface CreditCustomer {
  creditEnabled: boolean;
  documentType: number;
}

/** Credit needs a customer (not a final consumer), the flag on, and a NIT as the document. */
export function creditEligibility(customer: CreditCustomer | null | undefined): CreditEligibility {
  if (!customer) return { ok: false, reason: 'CUSTOMER_REQUIRED' };
  if (!customer.creditEnabled) return { ok: false, reason: 'CREDIT_NOT_ENABLED' };
  if (customer.documentType !== IdentityDocumentType.NIT) return { ok: false, reason: 'NIT_REQUIRED' };
  return { ok: true };
}

/** A term is a whole number of days from 1 to `CREDIT_MAX_TERM_DAYS`. */
export function validateCreditTerm(days: unknown): days is number {
  return typeof days === 'number' && Number.isInteger(days) && days >= 1 && days <= CREDIT_MAX_TERM_DAYS;
}

/** The due date: today (a La Paz `YYYY-MM-DD` day) plus the term in days. */
export function creditDueDate(today: string, termDays: number): string {
  if (!validateCreditTerm(termDays)) throw new Error(`Invalid credit term: ${termDays}`);
  return addDaysToDay(today, termDays);
}

/** What the payment screen needs to offer credit for the cart's customer. */
export interface PosCreditInfo {
  available: boolean;
  /** Why credit is not offered; `null` when it is. */
  reason: CreditIneligibleReason | null;
  /** The terms (days) of `sales.creditTermDays`; the screen adds "Otro". */
  termOptions: number[];
}
