import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import IORedis from 'ioredis';
import { PrismaService } from './common/prisma.service';
import { QUEUE } from './common/queues';
import { validateWorkerEnv, WorkerEnv } from './config/env';
import { OutboxRelayService } from './outbox/outbox-relay.service';
import { AccountingProcessor } from './processors/accounting.processor';
import { MailProcessor } from './processors/mail.processor';
import { SiatProcessor } from './processors/siat.processor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateWorkerEnv }),
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<WorkerEnv, true>) => ({
        connection: new IORedis(config.get('REDIS_URL'), { maxRetriesPerRequest: null }),
        prefix: 'rodasoft',
      }),
    }),
    BullModule.registerQueue({ name: QUEUE.mail }, { name: QUEUE.siat }, { name: QUEUE.accounting }),
  ],
  providers: [PrismaService, OutboxRelayService, MailProcessor, SiatProcessor, AccountingProcessor],
})
export class WorkerModule {}
