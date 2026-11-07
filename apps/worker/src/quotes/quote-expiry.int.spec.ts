/**
 * Integration test of the nightly quote expiry (HU-VEN-18) against the real Postgres: only sent quotes past their
 * validity expire, each one leaves an audit row without a user, a second run does nothing, and every company is covered.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../common/prisma.service';
import { QuoteExpiryService } from './quote-expiry.service';

const prisma = new PrismaClient();
const run = randomUUID().slice(0, 8);
const service = new QuoteExpiryService(prisma as unknown as PrismaService);
const NOW = new Date('2026-11-10T15:00:00Z'); // 11:00 in La Paz, 10 Nov
const companies: string[] = [];

async function seedCompany(label: string) {
  const company = await prisma.company.create({
    data: { slug: `quotes-${label}-${run}`, legalName: `Quotes ${label} ${run} S.R.L.`, tradeName: `Quotes ${label} ${run}`, nit: `${run}${label}` },
  });
  companies.push(company.id);
  const user = await prisma.user.create({ data: { email: `quotes-${label}-${run}@test.local`, name: 'Vendedor', passwordHash: 'x' } });
  const customer = await prisma.customer.create({
    data: { companyId: company.id, name: 'Cliente', documentType: 1, documentNumber: `${Math.floor(Math.random() * 1e8)}` },
  });
  return { company, user, customer };
}

async function seedQuote(
  seed: Awaited<ReturnType<typeof seedCompany>>,
  number: string,
  status: 'DRAFT' | 'SENT' | 'REJECTED',
  validUntil: string,
) {
  return prisma.quote.create({
    data: {
      companyId: seed.company.id,
      number,
      customerId: seed.customer.id,
      status,
      validUntil: new Date(`${validUntil}T00:00:00Z`),
      subtotal: '10.00',
      total: '10.00',
      createdById: seed.user.id,
    },
  });
}

describe('QuoteExpiryService (integration, real Postgres)', () => {
  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.quote.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.customer.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@test.local` } } });
    await prisma.company.deleteMany({ where: { id: { in: companies } } });
    await prisma.$disconnect();
  });

  it('expires only the sent quotes whose validity day has passed, in every company, once', async () => {
    const a = await seedCompany('a');
    const b = await seedCompany('b');
    const past = await seedQuote(a, 'COT-000001', 'SENT', '2026-11-09');
    const pastOtherCompany = await seedQuote(b, 'COT-000001', 'SENT', '2026-10-01');
    const lastDay = await seedQuote(a, 'COT-000002', 'SENT', '2026-11-10'); // valid through the whole day
    const future = await seedQuote(a, 'COT-000003', 'SENT', '2026-11-20');
    const draft = await seedQuote(a, 'COT-000004', 'DRAFT', '2026-11-01');
    const rejected = await seedQuote(a, 'COT-000005', 'REJECTED', '2026-11-01');

    expect(await service.expireDue(NOW)).toBeGreaterThanOrEqual(2);
    const statusOf = async (id: string) => (await prisma.quote.findUniqueOrThrow({ where: { id } })).status;
    expect(await statusOf(past.id)).toBe('EXPIRED');
    expect(await statusOf(pastOtherCompany.id)).toBe('EXPIRED');
    expect(await statusOf(lastDay.id)).toBe('SENT');
    expect(await statusOf(future.id)).toBe('SENT');
    expect(await statusOf(draft.id)).toBe('DRAFT');
    expect(await statusOf(rejected.id)).toBe('REJECTED');

    const logs = await prisma.auditLog.findMany({ where: { action: 'sales.quote.expire', entityId: { in: [past.id, pastOtherCompany.id] } } });
    expect(logs).toHaveLength(2);
    expect(logs.every((l) => l.userId === null && l.entity === 'Quote')).toBe(true);
    expect(logs.find((l) => l.entityId === past.id)?.companyId).toBe(a.company.id);

    // idempotent: nothing of ours is left to expire, and no second audit row appears
    await service.expireDue(NOW);
    expect(await prisma.auditLog.count({ where: { action: 'sales.quote.expire', entityId: past.id } })).toBe(1);
  }, 60_000);
});
