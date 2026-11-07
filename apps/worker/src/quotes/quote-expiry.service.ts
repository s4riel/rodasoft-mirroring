import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { laPazToday, quoteMachine } from '@rodasoft/domain';
import { PrismaService } from '../common/prisma.service';

/** Most quotes expired per run and transaction; the next night picks up the rest. */
const BATCH = 500;

/**
 * HU-VEN-18 · saves the `EXPIRED` status of the sent quotes whose validity day has passed. The API already shows them as
 * expired the moment the day ends (it computes the status on every read), so this job only makes the saved status
 * catch up, with its audit row. A quote is valid through its whole `valid_until` day, so the job runs just after midnight
 * in La Paz. `FOR UPDATE SKIP LOCKED` lets a user renew or reject a quote at the same moment without waiting or clashing.
 */
@Injectable()
export class QuoteExpiryService {
  private readonly logger = new Logger(QuoteExpiryService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('5 0 * * *', { timeZone: 'America/La_Paz' })
  async run(): Promise<void> {
    try {
      let expired: number;
      do {
        expired = await this.expireDue(new Date());
      } while (expired === BATCH);
    } catch (err) {
      this.logger.error('Error expiring the quotes', err as Error);
    }
  }

  /** Expires one batch; returns how many quotes it expired. Safe to run twice: the second run finds nothing. */
  async expireDue(now: Date): Promise<number> {
    const today = laPazToday(now);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; company_id: string }[]>`
        SELECT id, company_id FROM quotes
        WHERE status = 'SENT' AND valid_until < ${today}::date
        ORDER BY id
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED`;
      for (const row of rows) {
        const next = quoteMachine.next('SENT', 'expire');
        await tx.quote.update({ where: { id: row.id }, data: { status: next } });
        await tx.auditLog.create({
          data: {
            companyId: row.company_id,
            userId: null,
            action: 'sales.quote.expire',
            entity: 'Quote',
            entityId: row.id,
            before: { status: 'SENT' },
            after: { status: next },
          },
        });
      }
      if (rows.length > 0) this.logger.log(`${rows.length} quote(s) expired`);
      return rows.length;
    });
  }
}
