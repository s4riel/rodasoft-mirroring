/**
 * Closing VAT periods (HU-FAC-21). A period is one La Paz month. It is `OPEN` until a person closes it: closing freezes the
 * books and the cancellations of its documents. It cannot close while its month has not ended, while an earlier period is still
 * open, or while it has documents the SIAT has not issued or purchases it observes.
 */
import { currentVatBookPeriod, isVatBookPeriod } from './invoicing';
import type { Permission } from './permissions';
import { type VatPeriodStatus, vatPeriodMachine } from './state-machine';

export const VAT_PERIOD_STATUSES: readonly VatPeriodStatus[] = ['OPEN', 'CLOSED', 'FILED'];

export function isVatPeriodStatus(value: unknown): value is VatPeriodStatus {
  return typeof value === 'string' && (VAT_PERIOD_STATUSES as readonly string[]).includes(value);
}

export const VAT_PERIOD_REOPEN_REASON_MAX = 500;
export const VAT_PERIOD_REOPEN_REASON_MIN = 10;

export type VatPeriodReopenError = 'REASON_REQUIRED' | 'REASON_TOO_SHORT' | 'REASON_TOO_LONG';

/** What is wrong with the reason to reopen a period; empty when it can be sent. The reason is judged trimmed. */
export function validateReopenReason(reason: unknown): VatPeriodReopenError[] {
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (text === '') return ['REASON_REQUIRED'];
  if (text.length < VAT_PERIOD_REOPEN_REASON_MIN) return ['REASON_TOO_SHORT'];
  if (text.length > VAT_PERIOD_REOPEN_REASON_MAX) return ['REASON_TOO_LONG'];
  return [];
}

/** The period right after `period` (`2026-12` → `2027-01`). */
export function nextVatPeriod(period: string): string {
  const [year, month] = period.split('-').map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}

/** The period right before `period` (`2027-01` → `2026-12`). */
export function previousVatPeriod(period: string): string {
  const [year, month] = period.split('-').map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}

/** Every period from `first` to the current La Paz one, oldest first. Empty when `first` is not a period or lies in the future. */
export function listPeriods(first: string, now: Date): string[] {
  const current = currentVatBookPeriod(now);
  if (!isVatBookPeriod(first) || first > current) return [];
  const periods: string[] = [];
  for (let period = first; period <= current; period = nextVatPeriod(period)) periods.push(period);
  return periods;
}

/** What keeps a period from closing, as the counts the service reads. */
export interface PeriodCloseCounts {
  /** Invoices of the period that are not issued in the SIAT (`PENDING`, `SENDING`, `REJECTED`). */
  invoicesNotIssued: number;
  /** Credit and debit notes of the period that are not issued in the SIAT. */
  notesNotIssued: number;
  /** Purchase entries the SIN observes (the supplier NIT is unknown). */
  observedPurchases: number;
  /** Invoices of the period whose cancellation is under way in the SIAT: closing now would let it finish inside a closed period. */
  cancellationsInProgress: number;
}

export type PeriodBlockerCode = 'INVOICES_NOT_ISSUED' | 'NOTES_NOT_ISSUED' | 'PURCHASES_OBSERVED' | 'CANCELLATIONS_IN_PROGRESS';

export interface PeriodBlocker {
  code: PeriodBlockerCode;
  count: number;
}

/** The reasons a period cannot close, in display order; empty when nothing is pending. */
export function periodCloseBlockers(counts: PeriodCloseCounts): PeriodBlocker[] {
  const blockers: PeriodBlocker[] = [];
  if (counts.invoicesNotIssued > 0) blockers.push({ code: 'INVOICES_NOT_ISSUED', count: counts.invoicesNotIssued });
  if (counts.notesNotIssued > 0) blockers.push({ code: 'NOTES_NOT_ISSUED', count: counts.notesNotIssued });
  if (counts.observedPurchases > 0) blockers.push({ code: 'PURCHASES_OBSERVED', count: counts.observedPurchases });
  if (counts.cancellationsInProgress > 0) blockers.push({ code: 'CANCELLATIONS_IN_PROGRESS', count: counts.cancellationsInProgress });
  return blockers;
}

export type PeriodCloseError = 'PERIOD_ALREADY_CLOSED' | 'PERIOD_NOT_ENDED' | 'PREVIOUS_PERIOD_OPEN';

/**
 * Whether `period` can close now, apart from its pending documents: not already closed, its La Paz month over, and the period
 * before it (`previousStatus`, null when there is none) not still open. Returns the first error, or null.
 */
export function canClosePeriod(period: string, status: VatPeriodStatus, now: Date, previousStatus: VatPeriodStatus | null): PeriodCloseError | null {
  if (status !== 'OPEN') return 'PERIOD_ALREADY_CLOSED';
  if (period >= currentVatBookPeriod(now)) return 'PERIOD_NOT_ENDED';
  if (previousStatus === 'OPEN') return 'PREVIOUS_PERIOD_OPEN';
  return null;
}

export type VatPeriodAction = 'VIEW_BOOKS' | 'CLOSE' | 'FILE' | 'REOPEN';

/**
 * The actions a period in `status` offers to a user holding `permissions`, in menu order. `CLOSE` is offered for any open period:
 * whether it can close now (month over, earlier periods closed, nothing pending) is checked when it is asked.
 */
export function vatPeriodActions(status: VatPeriodStatus, permissions: Iterable<string>): VatPeriodAction[] {
  const granted = new Set<string>(permissions);
  const has = (permission: Permission) => granted.has(permission);
  if (!has('invoicing.vat-books.view')) return [];
  const actions: VatPeriodAction[] = ['VIEW_BOOKS'];
  if (!has('invoicing.vat-books.close')) return actions;
  if (vatPeriodMachine.can(status, 'close')) actions.push('CLOSE');
  if (vatPeriodMachine.can(status, 'file')) actions.push('FILE');
  if (vatPeriodMachine.can(status, 'reopen')) actions.push('REOPEN');
  return actions;
}

// ── Contracts ──

export interface VatPeriodRow {
  period: string;
  status: VatPeriodStatus;
  /** Net sales (invoiced less credited) and the 13 % fiscal debit; the snapshot of the close, live while open. */
  salesTotal: string;
  fiscalDebit: string;
  /** Valid invoices and valid purchases of the month (the periods table shows them next to the amounts). */
  salesCount: number;
  purchasesCount: number;
  /** Valid purchases and their tax credit. */
  purchasesTotal: string;
  vatCredit: string;
  closedAt: string | null;
  filedAt: string | null;
  actions: VatPeriodAction[];
}

export interface VatPeriodKpis {
  /** The current La Paz period. */
  current: string;
  /** The latest closed or filed period; null when none was closed. */
  lastClosed: string | null;
  /** Periods filed, out of `total`. */
  filed: number;
  total: number;
}

/** `GET invoicing/vat-periods`: newest period first. */
export interface VatPeriodsResponse {
  items: VatPeriodRow[];
  kpis: VatPeriodKpis;
}

export interface PeriodPendingDocument {
  kind: 'INVOICE' | 'CREDIT_NOTE' | 'CANCELLATION';
  id: string;
  number: number | null;
  status: string;
  customerName: string;
  total: string;
}

export interface PeriodPendingPurchase {
  id: string;
  supplierName: string;
  invoiceNumber: string;
  total: string;
}

/** `GET invoicing/vat-periods/:period/blockers`: what the close dialog shows (FS-40). */
export interface VatPeriodBlockers {
  period: string;
  /** The rule that stops the close besides pending documents, or null. */
  error: PeriodCloseError | null;
  blockers: PeriodBlocker[];
  /**
   * Valid invoices of the period whose sale has a cancellation request waiting for a decision. They do not stop the close (the SIAT
   * was not asked yet), but once the period is closed their approval is refused (`PERIOD_CLOSED`): they are corrected with a credit note.
   */
  cancellationRequests: number;
  documents: PeriodPendingDocument[];
  purchases: PeriodPendingPurchase[];
}
