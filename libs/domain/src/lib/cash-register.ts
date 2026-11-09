/**
 * The cash register during and at the end of a shift (HU-VEN-22 and HU-VEN-23): manual income and expenses, the cash the shift
 * should hold, the count by denomination and the difference at closing. Pure rules plus the contracts of the cash shift API.
 * Money values are decimal strings on the wire and `Decimal` in the rules, never `number`. The ERP turns every code into Spanish.
 */
import { OPENING_FLOAT_MAX, validateOpeningFloat } from './cash-shift';
import { Decimal } from './money';
import type { PaymentMethod } from './sale-receipt';
import type { CashMovementStatus, CashShiftStatus } from './state-machine';

// ── Manual movements ──

export const MANUAL_CASH_MOVEMENT_TYPES = ['INCOME', 'EXPENSE'] as const;
export type ManualCashMovementType = (typeof MANUAL_CASH_MOVEMENT_TYPES)[number];

/** Every type a `cash_movements` row can have: the sales and refunds are written by the POS, the cancellations and the returns. */
export type CashMovementType = ManualCashMovementType | 'SALE_PAYMENT' | 'REFUND';

/**
 * The concepts the cashier chooses from, per type (Figma VP-22b). Codes, not Spanish: the ERP translates them. `OTHER` needs a
 * detail. The list is a first guess from the design and easy to change here.
 */
export const CASH_MOVEMENT_CONCEPTS = {
  INCOME: ['BALANCE_COLLECTION', 'FLOAT_TOP_UP', 'OTHER'],
  EXPENSE: ['FREIGHT', 'PACKAGING', 'SERVICES', 'TRAVEL', 'SUPPLIES', 'OTHER'],
} as const satisfies Record<ManualCashMovementType, readonly string[]>;

export type CashMovementConcept = (typeof CASH_MOVEMENT_CONCEPTS)[ManualCashMovementType][number];

/** `cash_movements.reason` ("Detalle") limit. */
export const CASH_DETAIL_MAX = 200;

export function isManualCashMovementType(value: unknown): value is ManualCashMovementType {
  return typeof value === 'string' && (MANUAL_CASH_MOVEMENT_TYPES as readonly string[]).includes(value);
}

export function isCashConcept(type: ManualCashMovementType, value: unknown): value is CashMovementConcept {
  return typeof value === 'string' && (CASH_MOVEMENT_CONCEPTS[type] as readonly string[]).includes(value);
}

export type CashMovementFieldError =
  | 'INVALID_CASH_TYPE'
  | 'INVALID_CASH_AMOUNT'
  | 'INVALID_CASH_CONCEPT'
  | 'CASH_DETAIL_REQUIRED'
  | 'CASH_DETAIL_TOO_LONG';

/** The body of `POST /sales/cash-shifts/:id/movements` (multipart: the optional `receipt` file travels beside these fields). */
export interface CreateCashMovementInput {
  type: string;
  /** Decimal string with a dot (`"50.00"`), greater than zero. */
  amount: string;
  concept: string;
  detail?: string | null;
}

export type ValidCashMovement = { type: ManualCashMovementType; amount: Decimal; concept: CashMovementConcept; detail: string | null };

/** An amount for a movement: the opening-float format rules (at most 2 decimals, within the column) and strictly positive. */
export function parseCashAmount(text: string | null | undefined): Decimal | null {
  const parsed = validateOpeningFloat(text);
  return parsed.ok && !parsed.value.isZero() ? parsed.value : null;
}

/** Every problem of a movement; the first one decides the HTTP error. */
export function validateCashMovement(input: CreateCashMovementInput): { ok: true; value: ValidCashMovement } | { ok: false; errors: CashMovementFieldError[] } {
  const errors: CashMovementFieldError[] = [];
  if (!isManualCashMovementType(input.type)) return { ok: false, errors: ['INVALID_CASH_TYPE'] };
  const amount = parseCashAmount(input.amount);
  if (!amount) errors.push('INVALID_CASH_AMOUNT');
  if (!isCashConcept(input.type, input.concept)) errors.push('INVALID_CASH_CONCEPT');
  const detail = input.detail?.trim() || null;
  if (detail && detail.length > CASH_DETAIL_MAX) errors.push('CASH_DETAIL_TOO_LONG');
  if (input.concept === 'OTHER' && !detail) errors.push('CASH_DETAIL_REQUIRED');
  if (errors.length > 0 || !amount) return { ok: false, errors };
  return { ok: true, value: { type: input.type, amount, concept: input.concept as CashMovementConcept, detail } };
}

/** An expense above the company limit waits for Management; no limit configured (null) never asks (decision #16). */
export function needsExpenseApproval(amount: Decimal, limit: string | null): boolean {
  if (limit === null) return false;
  return amount.cmp(Decimal.of(limit)) > 0;
}

// ── The cash of a shift ──

/** What the cash rules read of a `cash_movements` row. */
export interface CashMovementAmount {
  type: CashMovementType;
  status: CashMovementStatus;
  amount: string;
}

export interface ShiftCashSummary {
  openingFloat: string;
  /** Σ SALE_PAYMENT: cash of the sales, net of the change given back. */
  cashSales: string;
  income: string;
  expenses: string;
  /** Σ REFUND: cash given back by cancellations and returns. */
  refunds: string;
  /** Opening float + cash sales + income − expenses − refunds. */
  expected: string;
}

/** The cash the register should hold. Only `POSTED` movements count: a pending, rejected or withdrawn expense never left the drawer. */
export function shiftCashSummary(input: { openingFloat: string; movements: readonly CashMovementAmount[] }): ShiftCashSummary {
  const total = (type: CashMovementType) =>
    input.movements
      .filter((m) => m.type === type && m.status === 'POSTED')
      .reduce((acc, m) => acc.add(Decimal.of(m.amount)), Decimal.zero());
  const openingFloat = Decimal.of(input.openingFloat);
  const cashSales = total('SALE_PAYMENT');
  const income = total('INCOME');
  const expenses = total('EXPENSE');
  const refunds = total('REFUND');
  return {
    openingFloat: openingFloat.toString(),
    cashSales: cashSales.toString(),
    income: income.toString(),
    expenses: expenses.toString(),
    refunds: refunds.toString(),
    expected: openingFloat.add(cashSales).add(income).sub(expenses).sub(refunds).toString(),
  };
}

/** A new expense may not take out more than the register holds. */
export function expenseExceedsCash(expected: string, amount: Decimal): boolean {
  return amount.cmp(Decimal.of(expected)) > 0;
}

// ── Sales per payment method ──

export const PAYMENT_METHODS: readonly PaymentMethod[] = ['CASH', 'QR', 'CARD', 'TRANSFER', 'CREDIT'];

/** The methods whose money is reconciled at closing: cash by the count, the others by what the cashier reads from terminal and bank. */
export const DECLARED_METHODS = ['QR', 'CARD', 'TRANSFER'] as const;
export type DeclaredMethod = (typeof DECLARED_METHODS)[number];

export interface MethodTotal {
  method: PaymentMethod;
  amount: string;
  count: number;
}

/**
 * Sales of a shift per payment method, in a fixed order. The caller passes the payments of the sales that are not cancelled.
 * CASH, QR, CARD and TRANSFER are always listed; CREDIT only when it has an amount (a credit sale is no money in the drawer).
 */
export function paymentMethodTotals(payments: readonly { method: PaymentMethod; amount: string }[]): MethodTotal[] {
  const totals = new Map<PaymentMethod, { amount: Decimal; count: number }>();
  for (const method of PAYMENT_METHODS) totals.set(method, { amount: Decimal.zero(), count: 0 });
  for (const payment of payments) {
    const entry = totals.get(payment.method);
    if (!entry) continue;
    entry.amount = entry.amount.add(Decimal.of(payment.amount));
    entry.count += 1;
  }
  return PAYMENT_METHODS.filter((method) => method !== 'CREDIT' || !(totals.get(method)?.amount.isZero() ?? true)).map((method) => {
    const entry = totals.get(method) as { amount: Decimal; count: number };
    return { method, amount: entry.amount.toString(), count: entry.count };
  });
}

// ── Count by denomination ──

/** Bills and coins the cashier counts, largest first (Figma VP-06). */
export const CASH_DENOMINATIONS = ['200.00', '100.00', '50.00', '20.00', '10.00', '5.00', '2.00', '1.00', '0.50'] as const;

/** Most pieces of one denomination a count accepts: a typing slip, not a real drawer. */
export const CASH_COUNT_MAX = 100_000;

export interface CashCountInput {
  denomination: string;
  quantity: number;
}

/** The denomination as the canonical 2-decimal string, or null when it is not one the cashier counts. */
export function normalizeDenomination(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  let normalized: string;
  try {
    normalized = Decimal.of(value).toString();
  } catch {
    return null;
  }
  return (CASH_DENOMINATIONS as readonly string[]).includes(normalized) ? normalized : null;
}

export type CashCountError = 'INVALID_DENOMINATION' | 'INVALID_COUNT';

/** The count cleaned (canonical denominations, no zero rows, largest first) or the first problem. A repeated denomination is refused. */
export function normalizeCashCounts(counts: readonly CashCountInput[]): { ok: true; counts: { denomination: string; quantity: number }[] } | { ok: false; error: CashCountError } {
  const byDenomination = new Map<string, number>();
  for (const count of counts) {
    const denomination = normalizeDenomination(count.denomination);
    if (!denomination || byDenomination.has(denomination)) return { ok: false, error: 'INVALID_DENOMINATION' };
    if (!Number.isInteger(count.quantity) || count.quantity < 0 || count.quantity > CASH_COUNT_MAX) return { ok: false, error: 'INVALID_COUNT' };
    byDenomination.set(denomination, count.quantity);
  }
  return {
    ok: true,
    counts: CASH_DENOMINATIONS.filter((d) => (byDenomination.get(d) ?? 0) > 0).map((d) => ({ denomination: d, quantity: byDenomination.get(d) as number })),
  };
}

/** Σ denomination × quantity. */
export function countedTotal(counts: readonly CashCountInput[]): Decimal {
  return counts.reduce((acc, count) => acc.add(Decimal.of(count.denomination).mul(Decimal.of(String(count.quantity), 0), 2)), Decimal.zero());
}

// ── Closing ──

export type ClosingError =
  | CashCountError
  | 'INVALID_CASH_AMOUNT'
  | 'CLOSING_FLOAT_EXCEEDS_COUNTED'
  | 'CLOSING_COMMENT_REQUIRED'
  | 'CLOSING_COMMENT_TOO_LONG';

export const CLOSING_COMMENT_MAX = 500;

/** The tolerance setting as an amount; a stored value that is not one means "any difference needs review". */
export function normalizeTolerance(value: string | null | undefined): string {
  const parsed = validateOpeningFloat(value);
  return parsed.ok ? parsed.value.toString() : '0.00';
}

/** The body of `POST /sales/cash-shifts/:id/close`. */
export interface CloseCashShiftInput {
  counts: CashCountInput[];
  /** What the cashier read from the terminals and the bank, as decimal strings. */
  declared: Record<DeclaredMethod, string>;
  /** Cash that stays in the register for the next shift. */
  closingFloat: string;
  /** Required when anything differs beyond the tolerance. */
  comment?: string | null;
}

export interface MethodDifference {
  method: PaymentMethod;
  system: string;
  declared: string;
  /** Declared minus system: negative is a shortage. */
  difference: string;
}

/** What the system holds at the moment of closing, read under the shift lock (never taken from the client). */
export interface ClosingSystemTotals {
  expectedCash: string;
  /** System amount for each declared method. */
  methods: Record<DeclaredMethod, string>;
}

export interface ClosingPlan {
  counts: { denomination: string; quantity: number }[];
  expected: string;
  counted: string;
  /** Counted minus expected. */
  difference: string;
  closingFloat: string;
  comment: string | null;
  /** Per method, cash first: the rows of `cash_shift_method_totals`, plus cash. */
  differences: MethodDifference[];
  /** Something differs beyond the tolerance: the shift goes to Accounting instead of being approved at once. */
  needsReview: boolean;
}

const isBeyond = (difference: Decimal, tolerance: Decimal) => difference.cmp(tolerance) > 0 || difference.cmp(tolerance.neg()) < 0;

/** Per method the declared amount against the system one, cash included, and whether any is beyond the tolerance. */
export function closingDifferences(
  system: ClosingSystemTotals,
  declared: { cash: Decimal } & Record<DeclaredMethod, Decimal>,
  tolerance: string,
): { differences: MethodDifference[]; needsReview: boolean } {
  const limit = Decimal.of(tolerance);
  const rows: { method: PaymentMethod; system: Decimal; declared: Decimal }[] = [
    { method: 'CASH', system: Decimal.of(system.expectedCash), declared: declared.cash },
    ...DECLARED_METHODS.map((method) => ({ method, system: Decimal.of(system.methods[method]), declared: declared[method] })),
  ];
  const differences = rows.map((row) => ({
    method: row.method,
    system: row.system.toString(),
    declared: row.declared.toString(),
    difference: row.declared.sub(row.system).toString(),
  }));
  return { differences, needsReview: differences.some((d) => isBeyond(Decimal.of(d.difference), limit)) };
}

/**
 * Checks a closing against what the system holds and builds the plan the service writes: the count, the differences, whether
 * Accounting must review it, and the comment. Returns the first problem otherwise.
 */
export function planClosing(
  input: CloseCashShiftInput,
  system: ClosingSystemTotals,
  tolerance: string,
): { ok: true; plan: ClosingPlan } | { ok: false; error: ClosingError } {
  const counts = normalizeCashCounts(input.counts ?? []);
  if (!counts.ok) return { ok: false, error: counts.error };

  const declared = {} as Record<DeclaredMethod, Decimal>;
  for (const method of DECLARED_METHODS) {
    const parsed = validateOpeningFloat(input.declared?.[method]);
    if (!parsed.ok) return { ok: false, error: 'INVALID_CASH_AMOUNT' };
    declared[method] = parsed.value;
  }
  const floatParsed = validateOpeningFloat(input.closingFloat);
  if (!floatParsed.ok) return { ok: false, error: 'INVALID_CASH_AMOUNT' };

  const counted = countedTotal(counts.counts);
  if (counted.cmp(OPENING_FLOAT_MAX) > 0) return { ok: false, error: 'INVALID_COUNT' };
  if (floatParsed.value.cmp(counted) > 0) return { ok: false, error: 'CLOSING_FLOAT_EXCEEDS_COUNTED' };

  const comment = input.comment?.trim() || null;
  if (comment && comment.length > CLOSING_COMMENT_MAX) return { ok: false, error: 'CLOSING_COMMENT_TOO_LONG' };
  const { differences, needsReview } = closingDifferences(system, { cash: counted, ...declared }, tolerance);
  if (needsReview && !comment) return { ok: false, error: 'CLOSING_COMMENT_REQUIRED' };

  return {
    ok: true,
    plan: {
      counts: counts.counts,
      expected: system.expectedCash,
      counted: counted.toString(),
      difference: counted.sub(Decimal.of(system.expectedCash)).toString(),
      closingFloat: floatParsed.value.toString(),
      comment,
      differences,
      needsReview,
    },
  };
}

// ── Contracts ──

/** One row of the movements table of VP-22. Sales are not listed here: they are summarised per method. */
export interface CashMovementRow {
  id: string;
  type: CashMovementType;
  status: CashMovementStatus;
  concept: string | null;
  detail: string | null;
  amount: string;
  by: { id: string; name: string };
  createdAt: string;
  hasReceipt: boolean;
}

/** The shift as VP-22 and VP-06 show it. */
export interface CashShiftDetail {
  id: string;
  status: CashShiftStatus;
  openingFloat: string;
  openedAt: string;
  openedBy: { id: string; name: string };
  closedAt: string | null;
  register: { id: string; name: string };
  branch: { id: string; name: string };
  warehouse: { id: string; name: string };
  /** Expenses above this wait for Management; null = never. */
  expenseApprovalLimit: string | null;
  /** A difference beyond this amount, either way, needs a justification and Accounting review. */
  differenceTolerance: string;
  denominations: string[];
  /** Sales of the shift that are not cancelled. */
  sales: { total: string; count: number };
  methods: MethodTotal[];
  cash: ShiftCashSummary;
  /** Expenses waiting for approval: they block the closing. */
  pendingExpenses: number;
  movements: CashMovementRow[];
}

export interface ApprovalOutcome {
  requestId: string;
  requestedBy: { id: string; name: string };
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
  comment: string | null;
}

/** A movement with where it was made and, for an expense that needed approval, how it went (VP-22 review card). */
export interface CashMovementDetail extends CashMovementRow {
  shift: { id: string; status: CashShiftStatus; register: { id: string; name: string } };
  approval: ApprovalOutcome | null;
  /** The caller may approve or reject it now. */
  canDecide: boolean;
  /** The caller may take the request back now. */
  canWithdraw: boolean;
}

export interface CashMovementDecisionInput {
  comment?: string;
}

export interface CloseCashShiftResponse {
  shiftId: string;
  /** `APPROVED` when nothing differs beyond the tolerance, `CLOSED` when Accounting has to review it. */
  status: CashShiftStatus;
  expectedAmount: string;
  countedAmount: string;
  differenceAmount: string;
  closingFloat: string;
  needsReview: boolean;
  methods: MethodDifference[];
}
