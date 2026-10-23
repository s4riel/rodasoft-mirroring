import { Injectable } from '@nestjs/common';
import { type CompanySettingKey, type CompanySettings, settingOrDefault } from '@rodasoft/domain';
import { PrismaService, type TenantTransaction } from '../prisma/prisma.service';

/** Tenant-scoped client, or the tenant-scoped client of a transaction. */
type SettingsDb = { companySetting: TenantTransaction['companySetting'] };

/**
 * Reads the per-company settings (HU-INV-06). Always returns a value: a missing row falls back to the typed default.
 * Reads go through the tenant client, so a company never sees another company's settings. Pass the `tx` of a business
 * transaction to read inside it.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get<K extends CompanySettingKey>(key: K, db: SettingsDb = this.prisma.tenant): Promise<CompanySettings[K]> {
    const row = await db.companySetting.findFirst({ where: { key }, select: { value: true } });
    return settingOrDefault(key, row?.value);
  }
}
