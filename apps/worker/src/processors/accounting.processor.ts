import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE } from '../common/queues';

/** Automatic journal entries from events (sale, collection, purchase, cash). Logic in S5. */
@Processor(QUEUE.accounting, { concurrency: 2 })
export class AccountingProcessor extends WorkerHost {
  private readonly logger = new Logger(AccountingProcessor.name);

  async process(job: Job) {
    this.logger.log(`[pending S5] ${job.name} (outbox ${job.data?.outboxId})`);
  }
}
