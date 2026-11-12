/**
 * What a customer owes on credit sales (HU-VEN-34, decision #53). Until accounts receivable (HU-CON-03) keeps its own ledger,
 * the balance is derived from the sales themselves: each credit sale owes what its `CREDIT` payment says, less what the
 * approved returns of that sale gave back (a credit sale collects no money, so every return reduces the debt), and nothing when
 * the sale was cancelled. Collecting payments against the balance arrives with HU-CON-03.
 */
import { Decimal, MONEY_SCALE } from './money';
import type { SaleStatus } from './state-machine';

/** One credit sale as the balance reads it. Money values are decimal strings. */
export interface CreditSaleFigures {
  status: SaleStatus;
  /** The `CREDIT` payment: what the customer was to pay. */
  amount: string;
  /** The day the balance falls due, `YYYY-MM-DD`. */
  dueDate: string;
  /** The sum of the sale's approved returns. */
  returned: string;
}

export interface CustomerCreditBalance {
  customerId: string;
  /** What the customer owes now, across every open credit sale. */
  balance: string;
  /** The part of the balance whose due date is before today (La Paz). */
  overdue: string;
  /** Credit sales that still owe something. */
  openSales: number;
  /** The earliest due date among the open sales; `null` when nothing is owed. */
  nextDueDate: string | null;
}

/** What one credit sale still owes: its credit less its returns, never below zero, and zero once cancelled. */
export function creditSaleOwed(sale: Pick<CreditSaleFigures, 'status' | 'amount' | 'returned'>): Decimal {
  if (sale.status === 'CANCELLED') return Decimal.zero(MONEY_SCALE);
  const owed = Decimal.of(sale.amount).sub(Decimal.of(sale.returned));
  return owed.isNegative() ? Decimal.zero(MONEY_SCALE) : owed;
}

/** The balance, the overdue part and the next due date of a customer's credit sales. `today` is the La Paz day. */
export function creditBalance(customerId: string, sales: readonly CreditSaleFigures[], today: string): CustomerCreditBalance {
  let balance = Decimal.zero(MONEY_SCALE);
  let overdue = Decimal.zero(MONEY_SCALE);
  let openSales = 0;
  let nextDueDate: string | null = null;
  for (const sale of sales) {
    const owed = creditSaleOwed(sale);
    if (owed.isZero()) continue;
    balance = balance.add(owed);
    openSales += 1;
    if (sale.dueDate < today) overdue = overdue.add(owed);
    if (nextDueDate === null || sale.dueDate < nextDueDate) nextDueDate = sale.dueDate;
  }
  return { customerId, balance: balance.toString(), overdue: overdue.toString(), openSales, nextDueDate };
}
