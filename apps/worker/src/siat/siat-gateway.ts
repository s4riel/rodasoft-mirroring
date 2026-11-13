import { type CompanySettingKey, type CompanySettings, settingOrDefault } from '@rodasoft/domain';
import { SimulatedSiatGateway, type SiatGateway } from '@rodasoft/siat';
import { PrismaService } from '../common/prisma.service';
import { PrismaSiatStore } from './prisma-siat-store';

/** One company setting, with its default; the worker has no tenant client, so it filters by company itself. */
export async function readSetting<K extends CompanySettingKey>(prisma: PrismaService, companyId: string, key: K): Promise<CompanySettings[K]> {
  const row = await prisma.companySetting.findFirst({ where: { companyId, key }, select: { value: true } });
  return settingOrDefault(key, row?.value);
}

export class SiatGatewayNotAvailableError extends Error {}

/**
 * The SIAT adapter of a company (`invoicing.siatGateway`). `SOAP` is refused until the real adapter exists (HU-FAC-22…26).
 * The API has its own copy of this choice (`apps/api/src/common/siat`): the two apps cannot share Nest providers.
 */
export async function siatGatewayFor(prisma: PrismaService, companyId: string): Promise<SiatGateway> {
  const kind = await readSetting(prisma, companyId, 'invoicing.siatGateway');
  if (kind !== 'SIMULATED') throw new SiatGatewayNotAvailableError('The SOAP SIAT adapter is not implemented yet');
  // the simulator issues fake "valid" invoices: in production it needs an explicit opt-in (a demo or pilot environment)
  if (process.env['NODE_ENV'] === 'production' && process.env['SIAT_ALLOW_SIMULATOR'] !== 'true') {
    throw new SiatGatewayNotAvailableError('The SIAT simulator is disabled in production (set SIAT_ALLOW_SIMULATOR=true to allow it)');
  }
  return new SimulatedSiatGateway(() => readSetting(prisma, companyId, 'invoicing.simulatorMode'), new PrismaSiatStore(prisma, companyId));
}
