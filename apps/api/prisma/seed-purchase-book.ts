/**
 * Demo purchases book (HU-FAC-19). The purchasing module does not exist yet, so `purchase_book_entries` is filled with demo
 * entries for the current and the previous La Paz month; when purchasing arrives it writes this table and this seed goes away.
 * Idempotent: it replaces its own rows (`source = 'SEED'`) and never touches rows another source wrote. Supplier names are display data
 * in Spanish; NITs starting with 999 are the ones the simulated SIN does not know, so one entry is observed.
 */
import type { PrismaClient } from '@prisma/client';
import { currentVatBookPeriod, fiscalDebit, laPazToday } from '@rodasoft/domain';

interface DemoPurchase {
  /** 0 = this month, 1 = last month. */
  monthsAgo: number;
  day: number;
  nit: string;
  supplier: string;
  invoice: string;
  total: string;
  observed?: boolean;
}

const DEMO_PURCHASES: DemoPurchase[] = [
  { monthsAgo: 0, day: 3, nit: '1020304110', supplier: 'Distribuidora Andina Demo S.R.L.', invoice: '004512', total: '4800.00' },
  { monthsAgo: 0, day: 2, nit: '1020304121', supplier: 'Transportes Demo Ltda.', invoice: '001873', total: '950.00' },
  { monthsAgo: 0, day: 1, nit: '9991234567', supplier: 'Embalajes Demo S.A.', invoice: '000221', total: '1200.00', observed: true },
  { monthsAgo: 1, day: 20, nit: '1020304143', supplier: 'Servicios Demo S.R.L.', invoice: '000087', total: '380.00' },
  { monthsAgo: 1, day: 12, nit: '1020304110', supplier: 'Distribuidora Andina Demo S.R.L.', invoice: '004388', total: '2650.00' },
];

export async function seedPurchaseBook(prisma: PrismaClient, companyId: string, now = new Date()): Promise<void> {
  const today = laPazToday(now);
  const [year, month] = today.split('-').map(Number);
  await prisma.purchaseBookEntry.deleteMany({ where: { companyId, source: 'SEED' } });
  for (const entry of DEMO_PURCHASES) {
    const first = new Date(Date.UTC(year, month - 1 - entry.monthsAgo, 1));
    const date = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), entry.day));
    await prisma.purchaseBookEntry.create({
      data: {
        companyId,
        period: currentVatBookPeriod(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 15, 12))),
        date,
        supplierNit: entry.nit,
        supplierName: entry.supplier,
        authorizationCode: `DEMO${entry.invoice}`,
        invoiceNumber: entry.invoice,
        total: entry.total,
        vatCredit: fiscalDebit(entry.total).toString(),
        status: entry.observed ? 'OBSERVED' : 'VALID',
        observation: entry.observed ? 'NIT INVALIDO' : null,
        source: 'SEED',
      },
    });
  }
}
