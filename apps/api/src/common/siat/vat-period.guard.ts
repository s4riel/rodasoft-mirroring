import { ConflictException, Injectable } from '@nestjs/common';
import { currentVatBookPeriod, type VatPeriodStatus } from '@rodasoft/domain';
import { PrismaService, type TenantClient } from '../prisma/prisma.service';

/** The part of a transaction client the guard uses (the tenant client's transaction and the plain one both fit). */
type GuardTx = Pick<TenantClient, '$executeRaw' | 'vatPeriod'>;

/**
 * Keeps the books of a closed VAT period from changing (HU-FAC-21). A write that belongs to a period (verifying a purchase NIT,
 * asking for or approving the cancellation of an invoice) calls `assertOpen` inside its transaction: it takes the advisory lock of
 * (company, period) and reads the period status under it. Closing and reopening take the same lock, so a close and a guarded write
 * of the same period never interleave: exactly one of them wins. A month without a row is `OPEN`.
 */
@Injectable()
export class VatPeriodGuard {
  constructor(private readonly prisma: PrismaService) {}

  /** The La Paz period a moment belongs to. */
  periodOf(moment: Date): string {
    return currentVatBookPeriod(moment);
  }

  /** Waits for whoever holds the lock of the period; released when the transaction ends. */
  async lock(tx: Pick<TenantClient, '$executeRaw'>, companyId: string, period: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`vat-period:${companyId}`}), hashtext(${period}))`;
  }

  /** The status of the period; read it under `lock` when the answer must not change meanwhile. */
  async statusOf(tx: Pick<TenantClient, 'vatPeriod'>, companyId: string, period: string): Promise<VatPeriodStatus> {
    const row = await tx.vatPeriod.findFirst({ where: { companyId, period }, select: { status: true } });
    return row?.status ?? 'OPEN';
  }

  /** Locks the period and refuses with 409 `PERIOD_CLOSED` unless it is open. */
  async assertOpen(tx: GuardTx, companyId: string, period: string): Promise<void> {
    await this.lock(tx, companyId, period);
    if ((await this.statusOf(tx, companyId, period)) !== 'OPEN') throw vatPeriodErrors.closed(period);
  }

  /** Read-only: whether the period is closed or filed now (no lock). */
  async isClosed(companyId: string, period: string): Promise<boolean> {
    return (await this.statusOf(this.prisma.tenant, companyId, period)) !== 'OPEN';
  }
}

export const vatPeriodErrors = {
  closed: (period: string) =>
    new ConflictException({ code: 'PERIOD_CLOSED', message: 'The VAT period is closed: correct it with a credit note or reopen the period', details: { period } }),
};
