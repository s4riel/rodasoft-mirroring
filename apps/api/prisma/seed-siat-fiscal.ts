/**
 * Demo fiscal configuration (HU-FAC-21…27): the simulated SIN catalogues as if they had been synced, the SIN code of most demo
 * products (a few are left pending so the homologation screen has something to do) and one closed VAT period. Idempotent. Nothing here
 * is a secret: the signature and the token are uploaded from the ERP.
 */
import type { PrismaClient, SiatCatalog } from '@prisma/client';
import { currentVatBookPeriod, previousVatPeriod, SIAT_CATALOGS } from '@rodasoft/domain';
import { SIMULATED_CATALOGS } from '@rodasoft/siat';

/** The SIN code a demo product gets by the name of its category. */
const CODE_BY_CATEGORY: Record<string, string> = {
  Rodamientos: '84821',
  'Retenes y sellos': '40169',
  'Correas y poleas': '40101',
  'Cadenas y piñones': '73151',
  'Lubricantes y grasas': '27101',
  Herramientas: '82050',
  Accesorios: '99100',
  Acoples: '84833',
};

export async function seedSiatFiscal(prisma: PrismaClient, companyId: string, now = new Date()): Promise<void> {
  for (const catalog of SIAT_CATALOGS) {
    const rows = SIMULATED_CATALOGS[catalog];
    for (const row of rows) {
      const activityCode = row.activityCode ?? '';
      await prisma.siatCatalogEntry.upsert({
        where: { companyId_catalog_activityCode_code: { companyId, catalog: catalog as SiatCatalog, activityCode, code: row.code } },
        create: { companyId, catalog: catalog as SiatCatalog, code: row.code, description: row.description, activityCode, active: true, syncedAt: now },
        update: { description: row.description, active: true, syncedAt: now },
      });
    }
    await prisma.siatCatalogSync.upsert({
      where: { companyId_catalog: { companyId, catalog: catalog as SiatCatalog } },
      create: { companyId, catalog: catalog as SiatCatalog, syncedAt: now, entryCount: rows.length },
      update: { syncedAt: now, entryCount: rows.length },
    });
  }

  const products = await prisma.product.findMany({ where: { companyId, status: 'ACTIVE' }, orderBy: { sku: 'asc' }, select: { id: true, sinProductCode: true, category: { select: { name: true } } } });
  const activityOf = new Map(SIMULATED_CATALOGS.PRODUCT_SERVICE.map((row) => [row.code, row.activityCode ?? '']));
  let index = 0;
  for (const product of products) {
    index += 1;
    // every fifth product stays pending
    if (index % 5 === 0 || product.sinProductCode) continue;
    const code = CODE_BY_CATEGORY[product.category.name] ?? '99100';
    await prisma.product.update({ where: { id: product.id }, data: { sinProductCode: code, sinActivityCode: activityOf.get(code) || null, sinUnitCode: 58 } });
  }

  // the main activity the invoices print; the rest of the fiscal data (signature, token) is loaded from the ERP
  await prisma.siatSettings.upsert({ where: { companyId }, create: { companyId, mainActivityCode: '465900', defaultProductCode: '99100' }, update: { mainActivityCode: '465900', defaultProductCode: '99100' } });

  // one closed period, two months back: the current and the previous month stay open for the demo of closing
  const closed = previousVatPeriod(previousVatPeriod(currentVatBookPeriod(now)));
  await prisma.vatPeriod.upsert({
    where: { companyId_period: { companyId, period: closed } },
    create: { companyId, period: closed, status: 'CLOSED', closedAt: now, salesTotal: '0.00', fiscalDebit: '0.00', purchasesTotal: '0.00', vatCredit: '0.00' },
    update: {},
  });
}
