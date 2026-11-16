import { type CreditableLine, Decimal, proRata } from '@rodasoft/domain';
import type { Prisma } from '@prisma/client';
import type { PrismaService, TenantTransaction } from '../../common/prisma/prisma.service';

const money = (value: Prisma.Decimal) => Decimal.of(value.toFixed(2));

/** What each line of an invoice was invoiced for and what the notes that are not voided already took back. */
export async function creditableLines(tx: TenantTransaction | PrismaService['tenant'], invoice: { id: string; saleId: string }): Promise<CreditableLine[]> {
  const [sale, credited] = await Promise.all([
    tx.sale.findFirstOrThrow({
      where: { id: invoice.saleId },
      select: { subtotal: true, total: true, items: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true, quantity: true, lineTotal: true } } },
    }),
    tx.creditNoteItem.groupBy({
      by: ['saleItemId'],
      where: { creditNote: { invoiceId: invoice.id, status: { not: 'CANCELLED' } } },
      _sum: { quantity: true, amount: true },
    }),
  ]);
  const taken = new Map(credited.map((row) => [row.saleItemId, row._sum]));
  return sale.items.map((item) => ({
    saleItemId: item.id,
    invoicedQuantity: item.quantity,
    // the sale discount and rounding are shared out among the lines, as a return does (`returnTotals`)
    invoicedAmount: proRata(money(item.lineTotal), money(sale.total), money(sale.subtotal)).toString(),
    creditedQuantity: taken.get(item.id)?.quantity ?? 0,
    creditedAmount: Decimal.of((taken.get(item.id)?.amount ?? 0).toString()).toString(),
  }));
}
