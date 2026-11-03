/**
 * Integration test of the document numbering against the real Postgres (DATABASE_URL): concurrent callers get distinct
 * consecutive numbers, and a rolled-back transaction leaves no gap. Creates throw-away companies and removes them.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { tenantExtension } from '../../common/prisma/tenant.extension';
import { nextDocumentNumber } from './document-sequence';

const run = randomUUID().slice(0, 8);

let current: string | null = null;
/** Same shape as PrismaService: the client itself plus a tenant-scoped extension of it. */
class TestPrisma extends PrismaClient {
  readonly tenant = this.$extends(tenantExtension(() => current));
}
const base = new TestPrisma();

async function createCompany(tag: string): Promise<string> {
  const company = await base.company.create({
    data: { slug: `seq-${tag}-${run}`, legalName: tag, tradeName: tag, nit: `S${tag}${run}`.slice(0, 20) },
  });
  return company.id;
}

describe('nextDocumentNumber (integration, real Postgres)', () => {
  let a: string;
  let b: string;

  beforeAll(async () => {
    a = await createCompany('a');
    b = await createCompany('b');
  });

  afterAll(async () => {
    for (const companyId of [a, b]) {
      await base.documentSequence.deleteMany({ where: { companyId } });
      await base.company.delete({ where: { id: companyId } });
    }
    await base.$disconnect();
  });

  const next = (companyId: string, series: Parameters<typeof nextDocumentNumber>[2]) => {
    current = companyId;
    return base.tenant.$transaction((tx) => nextDocumentNumber(tx, companyId, series));
  };

  it('starts at 1 and prints the series prefix', async () => {
    expect(await next(a, 'sale')).toBe('V-000001');
    expect(await next(a, 'sale')).toBe('V-000002');
    expect(await next(a, 'quote')).toBe('COT-000001');
  });

  it('keeps one counter per company', async () => {
    expect(await next(b, 'sale')).toBe('V-000001');
    expect(await next(a, 'sale')).toBe('V-000003');
  });

  it('gives 20 concurrent callers 20 distinct consecutive numbers', async () => {
    const numbers = await Promise.all(Array.from({ length: 20 }, () => next(a, 'order')));
    expect(new Set(numbers).size).toBe(20);
    const sequences = numbers.map((n) => Number(n.slice('PED-'.length))).sort((x, y) => x - y);
    expect(sequences).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('leaves no gap when the transaction rolls back', async () => {
    current = a;
    await expect(
      base.tenant.$transaction(async (tx) => {
        expect(await nextDocumentNumber(tx, a, 'dispatch')).toBe('DSP-000001');
        throw new Error('sale failed');
      }),
    ).rejects.toThrow('sale failed');
    expect(await next(a, 'dispatch')).toBe('DSP-000001');
  });
});
