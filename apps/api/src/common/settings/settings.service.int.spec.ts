/**
 * Integration test of the company settings against the real Postgres (DATABASE_URL): the typed defaults and the
 * isolation between companies. Creates throw-away companies and removes them at the end.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../prisma/prisma.service';
import { tenantExtension } from '../prisma/tenant.extension';
import { SettingsService } from './settings.service';

const run = randomUUID().slice(0, 8);

let current: string | null = null;
/** Same shape as PrismaService: the client itself plus a tenant-scoped extension of it. */
class TestPrisma extends PrismaClient {
  readonly tenant = this.$extends(tenantExtension(() => current));
}
const base = new TestPrisma();
const prisma = base as unknown as PrismaService;
const settings = new SettingsService(prisma);

async function createCompany(tag: string): Promise<string> {
  const company = await base.company.create({
    data: { slug: `set-${tag}-${run}`, legalName: tag, tradeName: tag, nit: `T${tag}${run}`.slice(0, 20) },
  });
  return company.id;
}

describe('SettingsService (integration, real Postgres)', () => {
  let a: string;
  let b: string;

  beforeAll(async () => {
    a = await createCompany('a');
    b = await createCompany('b');
  });

  afterAll(async () => {
    for (const companyId of [a, b]) {
      await base.companySetting.deleteMany({ where: { companyId } });
      await base.company.delete({ where: { id: companyId } });
    }
    await base.$disconnect();
  });

  it('falls back to the typed default when the company has no row', async () => {
    current = a;
    expect(await settings.get('inventory.skuPrefix')).toBe('RL-');
    expect(await settings.get('inventory.allowNegativeStock')).toBe(false);
    expect(await settings.get('adjustments.approvalThresholdValue')).toBeNull();
  });

  it('falls back to the decision defaults of the sales settings', async () => {
    current = a;
    expect(await settings.get('sales.roundingMode')).toBe('NONE');
    expect(await settings.get('sales.allowMixedPayment')).toBe(true);
    expect(await settings.get('sales.quoteValidityDays')).toBe(7);
    expect(await settings.get('sales.allowPartialDispatch')).toBe(true);
    expect(await settings.get('sales.cancellationWindowDays')).toBeNull();
    expect(await settings.get('sales.cashExpenseApprovalLimit')).toBeNull();
  });

  it('reads a stored sales setting and ignores an unknown rounding mode', async () => {
    await base.companySetting.create({ data: { companyId: b, key: 'sales.roundingMode', value: 'HALF_BOLIVIANO' } });
    current = b;
    expect(await settings.get('sales.roundingMode')).toBe('HALF_BOLIVIANO');
    await base.companySetting.update({ where: { companyId_key: { companyId: b, key: 'sales.roundingMode' } }, data: { value: 'UP' } });
    expect(await settings.get('sales.roundingMode')).toBe('NONE');
    await base.companySetting.delete({ where: { companyId_key: { companyId: b, key: 'sales.roundingMode' } } });
  });

  it('reads the company value and never another company’s', async () => {
    await base.companySetting.create({ data: { companyId: a, key: 'inventory.skuPrefix', value: 'AB-' } });

    current = a;
    expect(await settings.get('inventory.skuPrefix')).toBe('AB-');
    current = b;
    expect(await settings.get('inventory.skuPrefix')).toBe('RL-');
  });
});
