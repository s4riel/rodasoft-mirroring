import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { DEFAULT_JOB_OPTS, OUTBOX_ROUTES, QUEUE, QueueName } from '../common/queues';
import { PrismaService } from '../common/prisma.service';
import type { WorkerEnv } from '../config/env';

interface OutboxRow {
  id: bigint;
  company_id: string | null;
  type: string;
  payload: unknown;
  attempts: number;
}

/**
 * Publishes outbox events to BullMQ.
 * `FOR UPDATE SKIP LOCKED` lets several workers run without publishing the same event twice,
 * and `jobId = outbox-<id>` makes BullMQ ignore duplicates if the worker crashes midway.
 */
@Injectable()
export class OutboxRelayService {
  private readonly logger = new Logger(OutboxRelayService.name);
  private running = false;
  private readonly queues: Record<QueueName, Queue>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<WorkerEnv, true>,
    @InjectQueue(QUEUE.mail) mail: Queue,
    @InjectQueue(QUEUE.siat) siat: Queue,
    @InjectQueue(QUEUE.accounting) accounting: Queue,
  ) {
    this.queues = { mail, siat, accounting };
  }

  @Interval('outbox', 2000)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      let published: number;
      do {
        published = await this.publishBatch();
      } while (published === this.config.get('OUTBOX_BATCH'));
    } catch (err) {
      this.logger.error('Error publishing the outbox', err as Error);
    } finally {
      this.running = false;
    }
  }

  async publishBatch(): Promise<number> {
    const batch = this.config.get('OUTBOX_BATCH');
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<OutboxRow[]>`
        SELECT id, company_id, type, payload, attempts
        FROM outbox_events
        WHERE processed_at IS NULL AND available_at <= now()
        ORDER BY id
        LIMIT ${batch}
        FOR UPDATE SKIP LOCKED`;
      for (const row of rows) {
        const queueName = OUTBOX_ROUTES[row.type];
        try {
          if (!queueName) throw new Error(`Event type without a route: ${row.type}`);
          await this.queues[queueName].add(
            row.type,
            { outboxId: row.id.toString(), companyId: row.company_id, payload: row.payload },
            { ...DEFAULT_JOB_OPTS, jobId: `outbox-${row.id}` },
          );
          await tx.outboxEvent.update({ where: { id: row.id }, data: { processedAt: new Date(), error: null } });
        } catch (err) {
          const attempts = row.attempts + 1;
          const delayMs = Math.min(2 ** attempts * 1000, 15 * 60_000);
          await tx.outboxEvent.update({
            where: { id: row.id },
            data: { attempts, error: (err as Error).message.slice(0, 500), availableAt: new Date(Date.now() + delayMs) },
          });
          this.logger.warn(`Outbox ${row.id} (${row.type}) failed, retrying in ${delayMs / 1000}s: ${(err as Error).message}`);
        }
      }
      return rows.length;
    });
  }
}
