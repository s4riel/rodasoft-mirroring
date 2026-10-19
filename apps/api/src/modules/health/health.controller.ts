import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, HealthIndicatorService, PrismaHealthIndicator } from '@nestjs/terminus';
import Redis from 'ioredis';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InjectRedis } from '../../common/redis/redis.provider';
import { Public } from '../auth/decorators';

@ApiTags('salud')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly indicator: HealthIndicatorService,
    private readonly prisma: PrismaService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  /** Vivo: el proceso responde (lo usa Docker). */
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /** Listo: BD y Redis responden (lo usa Uptime Kuma). */
  @Get()
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.prismaHealth.pingCheck('postgres', this.prisma, { timeout: 2000 }),
      async () => {
        const r = this.indicator.check('redis');
        try {
          if (this.redis.status === 'wait') await this.redis.connect();
          await this.redis.ping();
          return r.up();
        } catch (e) {
          return r.down({ message: (e as Error).message });
        }
      },
    ]);
  }
}
