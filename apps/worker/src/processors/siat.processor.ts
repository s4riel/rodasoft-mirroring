import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { QUEUE } from '../common/queues';
import { InvoiceIssueService } from '../siat/invoice-issue.service';

interface SiatJob {
  outboxId: string;
  companyId: string | null;
  payload: { invoiceId?: string; manual?: boolean; userId?: string | null };
}

/**
 * SIAT jobs. In S0 it only schedules the recurring tasks; the logic arrives in S2-S3:
 *  - invoice.issue: numbers, builds the CUF and XML, sends to the SIAT and stores the result (VALID / REJECTED / back to PENDING when
 *    the SIAT does not answer: there is no contingency and no retry). Cancelling is synchronous in the API (HU-FAC-10).
 *  - cufd.renew: renews the CUFD of each point of sale (daily, before registers open).
 *  - catalogs.sync: activities, legends, cancellation reasons, event types.
 * Concurrency 1 per process to avoid saturating the SIN; scale with more processes if needed.
 */
@Processor(QUEUE.siat, { concurrency: 1 })
export class SiatProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(SiatProcessor.name);

  constructor(
    @InjectQueue(QUEUE.siat) private readonly queue: Queue,
    private readonly invoices: InvoiceIssueService,
  ) {
    super();
  }

  async onModuleInit() {
    // Bolivia time (UTC-4): 06:30 renew CUFD, 06:00 sync catalogs
    await this.queue.upsertJobScheduler('cufd-daily', { pattern: '30 6 * * *', tz: 'America/La_Paz' }, { name: 'cufd.renew' });
    await this.queue.upsertJobScheduler(
      'catalogs-daily',
      { pattern: '0 6 * * *', tz: 'America/La_Paz' },
      { name: 'catalogs.sync' },
    );
  }

  async process(job: Job<SiatJob>) {
    switch (job.name) {
      case 'cufd.renew':
      case 'catalogs.sync':
        this.logger.log(`[pending S2] ${job.name}`);
        return undefined;
      case 'invoice.issue': {
        const { companyId, payload } = job.data;
        if (!companyId || !payload.invoiceId) throw new Error('invoice.issue without company or invoice');
        // an unavailable SIAT is an outcome, not a failure: the job completes and the invoice waits for a person
        const outcome = await this.invoices.issue({ invoiceId: payload.invoiceId, companyId, manual: payload.manual === true, userId: payload.userId ?? null });
        this.logger.log(`invoice.issue ${payload.invoiceId}: ${outcome}`);
        return outcome;
      }
      default:
        this.logger.warn(`Unknown SIAT job: ${job.name}`);
        return undefined;
    }
  }
}
