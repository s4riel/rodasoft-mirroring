import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit/audit.service';
import { OutboxService } from './outbox/outbox.service';
import { PrismaService } from './prisma/prisma.service';
import { redisProvider, RedisLifecycle, REDIS } from './redis/redis.provider';
import { SecretsService } from './security/secrets.service';
import { SettingsService } from './settings/settings.service';
import { SiatGatewayFactory } from './siat/siat-gateway.factory';
import { VatPeriodGuard } from './siat/vat-period.guard';

@Global()
@Module({
  providers: [PrismaService, redisProvider, RedisLifecycle, SecretsService, AuditService, OutboxService, SettingsService, SiatGatewayFactory, VatPeriodGuard],
  exports: [PrismaService, REDIS, SecretsService, AuditService, OutboxService, SettingsService, SiatGatewayFactory, VatPeriodGuard],
})
export class CommonModule {}
