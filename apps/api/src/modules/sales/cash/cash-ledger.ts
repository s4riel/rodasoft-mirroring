import { Prisma } from '@prisma/client';
import {
  paymentMethodTotals,
  shiftCashSummary,
  type CashMovementStatus,
  type CashMovementType,
  type MethodTotal,
  type ShiftCashSummary,
} from '@rodasoft/domain';
import type { TenantTransaction } from '../../../common/prisma/prisma.service';

export const asTx = (tx: TenantTransaction) => tx as unknown as Prisma.TransactionClient;

/** The row of a shift as the locking query reads it. */
export interface LockedShift {
  id: string;
  status: string;
  openedById: string;
  openingFloat: string;
  registerId: string;
}

/**
 * The shift row locked `FOR UPDATE`, or `null` when it does not exist in the company. Everything that changes the cash of a
 * shift (an expense, its approval, the closing) takes this lock first, so they run one after another; the POS takes the same
 * row `FOR SHARE`, so a sale in flight finishes before a closing starts and a sale queued behind a closing is refused.
 * Lock order: the shift, then the cart or movement rows, then the document sequence, then products and stock.
 */
export async function lockShiftForUpdate(tx: TenantTransaction, shiftId: string, companyId: string): Promise<LockedShift | null> {
  const rows = await tx.$queryRaw<{ id: string; status: string; opened_by_id: string; opening_float: string; register_id: string }[]>`
    SELECT id::text AS id, status::text AS status, opened_by_id::text AS opened_by_id, opening_float::text AS opening_float, register_id::text AS register_id
    FROM cash_shifts WHERE id = ${shiftId}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;
  const row = rows[0];
  return row ? { id: row.id, status: row.status, openedById: row.opened_by_id, openingFloat: row.opening_float, registerId: row.register_id } : null;
}

/** The cash the shift should hold now, from its posted movements. Call it under the shift lock when the answer decides a write. */
export async function loadShiftCash(db: Pick<TenantTransaction, 'cashMovement'>, shiftId: string, openingFloat: string): Promise<ShiftCashSummary> {
  const groups = await db.cashMovement.groupBy({ by: ['type', 'status'], where: { shiftId }, _sum: { amount: true } });
  return shiftCashSummary({
    openingFloat,
    movements: groups.map((g) => ({
      type: g.type as CashMovementType,
      status: g.status as CashMovementStatus,
      amount: (g._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
    })),
  });
}


/** Sales of the shift that are not cancelled, with what each payment method took. */
export async function loadShiftSales(
  db: Pick<TenantTransaction, 'sale' | 'salePayment'>,
  shiftId: string,
): Promise<{ total: string; count: number; methods: MethodTotal[] }> {
  const [sales, payments] = await Promise.all([
    db.sale.aggregate({ where: { shiftId, status: { not: 'CANCELLED' } }, _sum: { total: true }, _count: { _all: true } }),
    db.salePayment.findMany({ where: { sale: { shiftId, status: { not: 'CANCELLED' } } }, select: { method: true, amount: true } }),
  ]);
  return {
    total: (sales._sum.total ?? new Prisma.Decimal(0)).toFixed(2),
    count: sales._count._all,
    methods: paymentMethodTotals(payments.map((p) => ({ method: p.method, amount: p.amount.toFixed(2) }))),
  };
}

/** The system amount of QR, card and transfer for the closing. */
export function declaredMethodSystemTotals(methods: readonly MethodTotal[]): { QR: string; CARD: string; TRANSFER: string } {
  const amountOf = (method: string) => methods.find((m) => m.method === method)?.amount ?? '0.00';
  return { QR: amountOf('QR'), CARD: amountOf('CARD'), TRANSFER: amountOf('TRANSFER') };
}
