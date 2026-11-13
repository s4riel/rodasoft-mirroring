import type { PrismaClient } from '@prisma/client';
import type { SimulatedSiatStore } from '@rodasoft/siat';

/**
 * What the simulated SIN remembers, kept in `simulated_siat_records` so the worker (which issues) and the API (which cancels)
 * see the same SIN. The real SIN keeps this itself, so this table is development-only.
 */
export class PrismaSiatStore implements SimulatedSiatStore {
  constructor(
    private readonly prisma: Pick<PrismaClient, 'simulatedSiatRecord'>,
    private readonly companyId: string,
  ) {}

  async accepted(cuf: string): Promise<string | null> {
    const row = await this.prisma.simulatedSiatRecord.findFirst({ where: { cuf, companyId: this.companyId }, select: { receptionCode: true } });
    return row?.receptionCode ?? null;
  }

  async remember(cuf: string, receptionCode: string): Promise<void> {
    await this.prisma.simulatedSiatRecord.upsert({
      where: { cuf },
      create: { cuf, companyId: this.companyId, receptionCode },
      update: {},
    });
  }

  async isCancelled(cuf: string): Promise<boolean> {
    const row = await this.prisma.simulatedSiatRecord.findFirst({ where: { cuf, companyId: this.companyId }, select: { cancelledAt: true } });
    return row?.cancelledAt != null;
  }

  async markCancelled(cuf: string): Promise<void> {
    await this.prisma.simulatedSiatRecord.updateMany({ where: { cuf, companyId: this.companyId, cancelledAt: null }, data: { cancelledAt: new Date() } });
  }
}
