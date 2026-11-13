import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { SiatUnavailableError } from '@rodasoft/siat';
import { PrismaService } from '../common/prisma.service';
import { readSetting, SiatGatewayNotAvailableError, siatGatewayFor } from './siat-gateway';

/**
 * Keeps `SiatSettings.connection*` up to date for the shell pill and the "SIAT is back" notification (HU-FAC-01). It only checks
 * the connection: it never issues anything, because there is no contingency and no automatic retry.
 */
@Injectable()
export class SiatHealthService {
  private readonly logger = new Logger(SiatHealthService.name);
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  /** Runs every minute; each company is only checked once its own `invoicing.statusCheckMinutes` has passed. */
  @Interval('siat-health', 60_000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.checkAll(new Date());
    } catch (err) {
      this.logger.error('Error checking the SIAT connection', err as Error);
    } finally {
      this.running = false;
    }
  }

  async checkAll(now: Date): Promise<void> {
    const companies = await this.prisma.company.findMany({ select: { id: true } });
    for (const { id } of companies) await this.checkCompany(id, now);
  }

  /** Returns whether the company was due and checked. */
  async checkCompany(companyId: string, now: Date): Promise<boolean> {
    const minutes = await readSetting(this.prisma, companyId, 'invoicing.statusCheckMinutes');
    const settings = await this.prisma.siatSettings.findUnique({ where: { companyId }, select: { connectionStatus: true, connectionCheckedAt: true } });
    if (settings?.connectionCheckedAt && now.getTime() - settings.connectionCheckedAt.getTime() < minutes * 60_000) return false;

    let online: boolean;
    try {
      const gateway = await siatGatewayFor(this.prisma, companyId);
      online = (await gateway.verifyCommunication()).success;
    } catch (error) {
      if (!(error instanceof SiatUnavailableError) && !(error instanceof SiatGatewayNotAvailableError)) throw error;
      online = false;
    }
    const status = online ? 'ONLINE' : 'OFFLINE';
    const changed = settings?.connectionStatus !== status;
    await this.prisma.siatSettings.upsert({
      where: { companyId },
      create: { companyId, connectionStatus: status, connectionCheckedAt: now, connectionChangedAt: now },
      update: { connectionStatus: status, connectionCheckedAt: now, ...(changed ? { connectionChangedAt: now } : {}) },
    });
    return true;
  }
}
