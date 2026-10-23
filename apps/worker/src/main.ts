import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

/** Process without HTTP: outbox → BullMQ queues → processors (mail, SIAT, accounting). */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  Logger.log('Worker ready: outbox, mail, siat, accounting, inventory', 'Worker');
}

bootstrap();
