import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE } from '../common/queues';

/**
 * Inventory events (product created, and later stock and transfer events). No consumer yet: the job is logged and
 * completes, so the event leaves the outbox instead of retrying. The web catalog sync will replace this.
 */
@Processor(QUEUE.inventory, { concurrency: 2 })
export class InventoryProcessor extends WorkerHost {
  private readonly logger = new Logger(InventoryProcessor.name);

  async process(job: Job) {
    this.logger.log(`[no consumer yet] ${job.name} (outbox ${job.data?.outboxId})`);
  }
}
