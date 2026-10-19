import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { QUEUE } from '../common/queues';

/**
 * Trabajos del SIAT. En S0 solo deja programadas las tareas; la lógica llega en S2–S3:
 *  - factura.emitir: arma XML, firma, empaqueta, envía y guarda el resultado (estado VALIDA/RECHAZADA/CONTINGENCIA).
 *  - factura.anular: anulación aprobada por Gerencia.
 *  - cufd.renovar: renueva el CUFD de cada punto de venta (diario, antes de abrir cajas).
 *  - catalogos.sincronizar: actividades, leyendas, motivos de anulación, tipos de evento.
 *  - contingencia.regularizar: arma y envía paquetes de facturas emitidas fuera de línea.
 * Concurrencia 1 por proceso para no saturar al SIN; escalar con más procesos si hace falta.
 */
@Processor(QUEUE.siat, { concurrency: 1 })
export class SiatProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(SiatProcessor.name);

  constructor(@InjectQueue(QUEUE.siat) private readonly queue: Queue) {
    super();
  }

  async onModuleInit() {
    // hora de Bolivia (UTC-4): 06:30 renovar CUFD, 06:00 sincronizar catálogos
    await this.queue.upsertJobScheduler('cufd-diario', { pattern: '30 6 * * *', tz: 'America/La_Paz' }, { name: 'cufd.renovar' });
    await this.queue.upsertJobScheduler(
      'catalogos-diario',
      { pattern: '0 6 * * *', tz: 'America/La_Paz' },
      { name: 'catalogos.sincronizar' },
    );
  }

  async process(job: Job) {
    switch (job.name) {
      case 'cufd.renovar':
      case 'catalogos.sincronizar':
        this.logger.log(`[pendiente S2] ${job.name}`);
        return;
      case 'factura.emitir':
      case 'factura.anular':
        // Mientras no exista el flujo, falla para que el evento quede pendiente y visible.
        throw new Error(`[pendiente S2] ${job.name} aún no implementado`);
      default:
        this.logger.warn(`Trabajo SIAT desconocido: ${job.name}`);
    }
  }
}
