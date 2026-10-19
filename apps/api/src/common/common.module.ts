import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit/audit.service';
import { OutboxService } from './outbox/outbox.service';
import { PrismaService } from './prisma/prisma.service';
import { redisProvider, RedisLifecycle, REDIS } from './redis/redis.provider';
import { SecretsService } from './security/secrets.service';

@Global()
@Module({
  providers: [PrismaService, redisProvider, RedisLifecycle, SecretsService, AuditService, OutboxService],
  exports: [PrismaService, REDIS, SecretsService, AuditService, OutboxService],
})
export class CommonModule {}
