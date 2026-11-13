import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { SimulatedSiatGateway, type SiatGateway } from '@rodasoft/siat';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../cls';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { PrismaSiatStore } from './prisma-siat-store';

/**
 * The SIAT adapter of the request's company, chosen by `invoicing.siatGateway`. Shared by invoicing (verify a NIT) and sales
 * (cancel an invoice in the SIAT), so neither imports the other. `SOAP` is refused until the real adapter exists (HU-FAC-22…26).
 */
@Injectable()
export class SiatGatewayFactory {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async forCurrentCompany(): Promise<SiatGateway> {
    const companyId = this.cls.get('companyId');
    if (!companyId) throw new Error('No company in the request context');
    const kind = await this.settings.get('invoicing.siatGateway');
    if (kind !== 'SIMULATED') {
      throw new ServiceUnavailableException({ code: 'SIAT_GATEWAY_NOT_AVAILABLE', message: 'The SOAP SIAT adapter is not implemented yet' });
    }
    // the simulator issues fake "valid" invoices: in production it needs an explicit opt-in (a demo or pilot environment)
    if (process.env['NODE_ENV'] === 'production' && process.env['SIAT_ALLOW_SIMULATOR'] !== 'true') {
      throw new ServiceUnavailableException({ code: 'SIAT_GATEWAY_NOT_AVAILABLE', message: 'The SIAT simulator is disabled in production (set SIAT_ALLOW_SIMULATOR=true to allow it)' });
    }
    return new SimulatedSiatGateway(() => this.settings.get('invoicing.simulatorMode'), new PrismaSiatStore(this.prisma, companyId));
  }
}
