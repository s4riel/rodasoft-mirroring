import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { QUEUE } from '../common/queues';

/**
 * SIAT jobs. In S0 it only schedules the recurring tasks; the logic arrives in S2-S3:
 *  - invoice.issue: builds the XML, signs, packages, sends and stores the result (status VALID/REJECTED/CONTINGENCY).
 *  - invoice.cancel: cancellation approved by Management.
 *  - cufd.renew: renews the CUFD of each point of sale (daily, before registers open).
 *  - catalogs.sync: activities, legends, cancellation reasons, event types.
 *  - contingency.regularize: builds and sends packages of invoices issued offline.
 * Concurrency 1 per process to avoid saturating the SIN; scale with more processes if needed.
 */
@Processor(QUEUE.siat, { concurrency: 1 })
export class SiatProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(SiatProcessor.name);

  constructor(@InjectQueue(QUEUE.siat) private readonly queue: Queue) {
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

  async process(job: Job) {
    switch (job.name) {
      case 'cufd.renew':
      case 'catalogs.sync':
        this.logger.log(`[pending S2] ${job.name}`);
        return;
      case 'invoice.issue':
      case 'invoice.cancel':
        // Until the flow exists, fail so the event stays pending and visible.
        throw new Error(`[pending S2] ${job.name} not implemented yet`);
      default:
        this.logger.warn(`Unknown SIAT job: ${job.name}`);
    }
  }
}
