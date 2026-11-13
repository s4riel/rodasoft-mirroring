import type { Prisma } from '@prisma/client';
import type { OutboxService } from '../outbox/outbox.service';
import type { TenantTransaction } from '../prisma/prisma.service';
import type { SettingsService } from '../settings/settings.service';

/**
 * The SIAT point of sale a new invoice belongs to: the one of the register the sale was paid at, or the lowest-code point of the
 * branch for a sale born from a dispatch. Null when the company has none yet; the first issue attempt then fails with
 * `POINT_OF_SALE_MISSING` and the invoice stays `PENDING`.
 */
export async function pointOfSaleOfSale(tx: TenantTransaction, input: { branchId: string; shiftId?: string | null }): Promise<string | null> {
  if (input.shiftId) {
    const shift = await tx.cashShift.findFirst({ where: { id: input.shiftId }, select: { register: { select: { pointOfSaleId: true } } } });
    if (shift) return shift.register.pointOfSaleId;
  }
  const point = await tx.siatPointOfSale.findFirst({ where: { branchId: input.branchId }, orderBy: { code: 'asc' }, select: { id: true } });
  return point?.id ?? null;
}

/**
 * The first, automatic issue attempt of an invoice (`invoicing.autoIssueOnSale`). It is published in the transaction of the sale, so
 * the event exists exactly when the sale does. The worker moves the invoice to `SENDING` itself, so a lost event leaves a plain
 * `PENDING` invoice that a person issues by hand (there is no contingency and no retry).
 */
export async function publishFirstIssueAttempt(
  deps: { settings: SettingsService; outbox: OutboxService },
  tx: TenantTransaction,
  invoiceId: string,
): Promise<void> {
  if (!(await deps.settings.get('invoicing.autoIssueOnSale', tx))) return;
  await deps.outbox.publish('invoice.issue', { invoiceId, attempt: 1, manual: false }, { tx: tx as unknown as Prisma.TransactionClient, idempotencyKey: `invoice-issue:${invoiceId}:1` });
}
