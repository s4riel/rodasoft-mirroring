import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, HealthIndicatorService, PrismaHealthIndicator } from '@nestjs/terminus';
import Redis from 'ioredis';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InjectRedis } from '../../common/redis/redis.provider';
import { Public } from '../auth/decorators';

@ApiTags('health')
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

  /** Live: the process responds (used by Docker). */
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /** Ready: DB and Redis respond (used by Uptime Kuma). */
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
