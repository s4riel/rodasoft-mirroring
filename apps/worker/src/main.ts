import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

/** Proceso sin HTTP: outbox → colas BullMQ → procesadores (correo, SIAT, contabilidad). */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  Logger.log('Worker listo: outbox, mail, siat, contabilidad', 'Worker');
}

bootstrap();
