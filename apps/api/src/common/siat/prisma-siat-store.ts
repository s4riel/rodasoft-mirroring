import type { PrismaClient } from '@prisma/client';
import type { SimulatedSiatStore } from '@rodasoft/siat';

/**
 * What the simulated SIN remembers, kept in `simulated_siat_records` so the worker (which issues) and the API (which cancels)
 * see the same SIN. The worker has its own copy of this class: the two apps share no Nest providers. Development only.
 */
export class PrismaSiatStore implements SimulatedSiatStore {
  constructor(
    private readonly prisma: Pick<PrismaClient, 'simulatedSiatRecord' | '$transaction'>,
    private readonly companyId: string,
  ) {}

  async accepted(cuf: string): Promise<string | null> {
    const row = await this.prisma.simulatedSiatRecord.findFirst({ where: { cuf, companyId: this.companyId }, select: { receptionCode: true } });
    return row?.receptionCode ?? null;
  }

  async remember(cuf: string, receptionCode: string): Promise<void> {
    await this.prisma.simulatedSiatRecord.upsert({ where: { cuf }, create: { cuf, companyId: this.companyId, receptionCode }, update: {} });
  }

  async isCancelled(cuf: string): Promise<boolean> {
    const row = await this.prisma.simulatedSiatRecord.findFirst({ where: { cuf, companyId: this.companyId }, select: { cancelledAt: true } });
    return row?.cancelledAt != null;
  }

  async markCancelled(cuf: string): Promise<void> {
    await this.prisma.simulatedSiatRecord.updateMany({ where: { cuf, companyId: this.companyId, cancelledAt: null }, data: { cancelledAt: new Date() } });
  }

  /**
   * Point-of-sale codes live in the same table, keyed `POS:<company>:<branch>:<name>` with the code as the reception code. A lock per
   * company and branch makes two concurrent registrations get different codes.
   */
  async registerPointOfSale(branchCode: number, name: string, knownCodes: readonly number[]): Promise<number> {
    const prefix = `POS:${this.companyId}:${branchCode}:`;
    const key = `${prefix}${name.trim().toLowerCase()}`;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${prefix}))`;
      const existing = await tx.simulatedSiatRecord.findFirst({ where: { cuf: key, companyId: this.companyId }, select: { receptionCode: true } });
      if (existing) return Number(existing.receptionCode);
      const issued = await tx.simulatedSiatRecord.findMany({ where: { companyId: this.companyId, cuf: { startsWith: prefix } }, select: { receptionCode: true } });
      const code = Math.max(0, ...knownCodes, ...issued.map((row) => Number(row.receptionCode))) + 1;
      await tx.simulatedSiatRecord.create({ data: { cuf: key, companyId: this.companyId, receptionCode: String(code) } });
      return code;
    });
  }
}
