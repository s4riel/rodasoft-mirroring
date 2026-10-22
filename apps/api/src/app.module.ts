import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import type { AppClsStore } from './common/cls';
import { CommonModule } from './common/common.module';
import { ProblemFilter } from './common/filters/problem.filter';
import { validateEnv } from './config/env';
import { AccessModule } from './modules/access/access.module';
import { PermissionsGuard } from './modules/access/permissions.guard';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { HealthModule } from './modules/health/health.module';
import { resolveCompanySlug } from './modules/tenancy/tenant-resolver';
import { TenancyModule } from './modules/tenancy/tenancy.module';
import { TenantGuard } from './modules/tenancy/tenant.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    LoggerModule.forRoot({
      pinoHttp: {
        genReqId: (req) => (req.headers['x-request-id'] as string) ?? randomUUID(),
        transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
        redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
        autoLogging: { ignore: (req) => req.url?.startsWith('/api/v1/health') ?? false },
      },
    }),
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        setup: (cls, req) => {
          const c = cls as unknown as import('nestjs-cls').ClsService<AppClsStore>;
          c.set('companySlug', resolveCompanySlug(req));
          c.set('companyId', null);
          c.set('userId', null);
          c.set('membershipId', null);
          c.set('ip', (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket?.remoteAddress ?? null);
          c.set('userAgent', (req.headers['user-agent'] as string) ?? null);
        },
      },
    }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    CommonModule,
    TenancyModule,
    AuthModule,
    AccessModule,
    HealthModule,
  ],
  providers: [
    // order: rate limit -> token -> company -> permissions
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: TenantGuard },
    { provide: APP_GUARD, useExisting: PermissionsGuard },
    { provide: APP_FILTER, useClass: ProblemFilter },
  ],
})
export class AppModule {}
