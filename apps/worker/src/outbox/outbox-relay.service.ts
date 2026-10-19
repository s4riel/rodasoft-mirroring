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
  empresa_id: string | null;
  tipo: string;
  payload: unknown;
  intentos: number;
}

/**
 * Publica los eventos del outbox en BullMQ.
 * `FOR UPDATE SKIP LOCKED` permite correr varios workers sin publicar dos veces el mismo evento,
 * y `jobId = outbox-<id>` hace que BullMQ ignore duplicados si el worker se cae a mitad de camino.
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
    @InjectQueue(QUEUE.contabilidad) contabilidad: Queue,
  ) {
    this.queues = { mail, siat, contabilidad };
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
      this.logger.error('Error publicando el outbox', err as Error);
    } finally {
      this.running = false;
    }
  }

  async publishBatch(): Promise<number> {
    const batch = this.config.get('OUTBOX_BATCH');
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<OutboxRow[]>`
        SELECT id, empresa_id, tipo, payload, intentos
        FROM outbox_event
        WHERE procesado_en IS NULL AND disponible_en <= now()
        ORDER BY id
        LIMIT ${batch}
        FOR UPDATE SKIP LOCKED`;
      for (const row of rows) {
        const queueName = OUTBOX_ROUTES[row.tipo];
        try {
          if (!queueName) throw new Error(`Tipo de evento sin ruta: ${row.tipo}`);
          await this.queues[queueName].add(
            row.tipo,
            { outboxId: row.id.toString(), empresaId: row.empresa_id, payload: row.payload },
            { ...DEFAULT_JOB_OPTS, jobId: `outbox-${row.id}` },
          );
          await tx.outboxEvent.update({ where: { id: row.id }, data: { procesadoEn: new Date(), error: null } });
        } catch (err) {
          const intentos = row.intentos + 1;
          const delayMs = Math.min(2 ** intentos * 1000, 15 * 60_000);
          await tx.outboxEvent.update({
            where: { id: row.id },
            data: { intentos, error: (err as Error).message.slice(0, 500), disponibleEn: new Date(Date.now() + delayMs) },
          });
          this.logger.warn(`Outbox ${row.id} (${row.tipo}) falló, reintento en ${delayMs / 1000}s: ${(err as Error).message}`);
        }
      }
      return rows.length;
    });
  }
}
