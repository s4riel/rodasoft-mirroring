import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE } from '../common/queues';

/** Asientos automáticos a partir de eventos (venta, cobro, compra, caja). Lógica en S5. */
@Processor(QUEUE.contabilidad, { concurrency: 2 })
export class ContabilidadProcessor extends WorkerHost {
  private readonly logger = new Logger(ContabilidadProcessor.name);

  async process(job: Job) {
    this.logger.log(`[pendiente S5] ${job.name} (outbox ${job.data?.outboxId})`);
  }
}
