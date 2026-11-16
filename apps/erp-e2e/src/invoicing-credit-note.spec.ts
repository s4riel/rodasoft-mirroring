import { PrismaClient } from '@prisma/client';
import { expect, test } from '@playwright/test';
import { login } from './support/auth';
import { invoiceOfSale, resetAdminShifts, sellableCode, sellOne } from './support/invoicing';

/**
 * HU-FAC-11, HU-FAC-12 · a valid invoice is returned: the return writes a credit and debit note that waits for the SIAT, the note
 * shows in "Notas de crédito" and, once the SIAT validates it, reads "Válida" in the list and in its detail with the VAT it adjusts
 * and the return it comes from. The SIAT's answer is decided by the test (the worker may not run during E2E): the note is turned
 * VALID in the database, like the invoice. Needs the demo data from `pnpm db:seed`.
 */

const prisma = new PrismaClient();
let code = '';

test.beforeAll(async () => {
  await resetAdminShifts(prisma);
  code = await sellableCode(prisma);
});

test.afterAll(async () => {
  await resetAdminShifts(prisma);
  await prisma.$disconnect();
});

test('a return of a valid invoice leaves a pending note that, once validated by the SIAT, reads Válida in the list and the detail', async ({ page }) => {
  await login(page);
  const saleNumber = await sellOne(page, code);
  const invoice = await invoiceOfSale(prisma, saleNumber);
  const invoiceNumber = 800000 + (Date.now() % 90000);
  const invoiceCuf = `E2EINV${Date.now()}SIM0`;
  await prisma.simulatedSiatRecord.create({ data: { cuf: invoiceCuf, companyId: invoice.companyId, receptionCode: 'SIM-E2E' } });
  await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'VALID', number: invoiceNumber, cuf: invoiceCuf, issuedAt: new Date(), siatReceptionCode: 'SIM-E2E' } });

  // no automatic first attempt: a running worker would validate the note before the test looks at it pending
  const autoKey = 'invoicing.autoIssueOnSale';
  await prisma.companySetting.upsert({
    where: { companyId_key: { companyId: invoice.companyId, key: autoKey } },
    create: { companyId: invoice.companyId, key: autoKey, value: false },
    update: { value: false },
  });

  try {
    // return the piece from the sale detail
    await page.goto(`/sales/history/${invoice.saleId}`);
    await page.getByTestId('sale-return').click();
    await expect(page.getByRole('heading', { name: 'Nueva devolución' })).toBeVisible();
    await page.getByLabel('Motivo de la devolución').click();
    await page.locator('li[role="option"]').filter({ hasText: 'Producto con falla de fábrica' }).first().click();
    await page.locator('rs-qty-stepper button').last().click();
    await page.getByRole('group', { name: /Destino de/ }).getByRole('button', { name: 'A stock' }).click();
    await page.getByTestId('return-submit').click();
    await expect(page.getByRole('heading', { name: /^Devolución DEV-\d{6}$/ })).toBeVisible();
    const returnNumber = (await page.getByRole('heading', { name: /^Devolución DEV-\d{6}$/ }).textContent())?.match(/DEV-\d{6}/)?.[0] ?? '';

    // the note was born with the return, still waiting for the SIAT
    const note = await prisma.creditNote.findFirstOrThrow({ where: { invoiceId: invoice.id }, include: { items: true } });
    expect(note).toMatchObject({ status: 'PENDING', number: null, reasonCode: 2 });
    expect(note.items).toHaveLength(1);

    await page.goto('/invoicing/notes');
    await expect(page.getByRole('heading', { name: 'Notas de crédito y débito', level: 1 })).toBeVisible();
    const pending = page.locator('rs-doc-table tbody tr').filter({ hasText: returnNumber });
    await expect(pending).toContainText('No emitida en SIAT');
    await expect(pending).toContainText(String(invoiceNumber).padStart(6, '0'));

    // the SIAT validates it
    const noteNumber = 700000 + (Date.now() % 90000);
    await prisma.creditNote.update({
      where: { id: note.id },
      data: { status: 'VALID', number: noteNumber, cuf: `E2ENOTE${Date.now()}SIM0`, issuedAt: new Date(), siatReceptionCode: 'SIM-NC-E2E' },
    });
    await page.reload();
    const valid = page.locator('rs-doc-table tbody tr').filter({ hasText: returnNumber });
    await expect(valid).toContainText('Válida');
    await expect(valid).toContainText('Devolución ' + returnNumber);

    // the detail: the VAT it adjusts, the linked return and the original invoice
    await valid.locator('a.number').click();
    await expect(page.getByRole('heading', { name: `Nota de crédito y débito ${String(noteNumber).padStart(6, '0')}` })).toBeVisible();
    await expect(page.locator('rs-status-pill', { hasText: 'Válida' }).first()).toBeVisible();
    await expect(page.getByTestId('note-summary')).toContainText('IVA a ajustar (13 %)');
    await expect(page.getByTestId('note-summary')).toContainText(`Devolución ${returnNumber}`);
    await expect(page.getByTestId('note-summary')).toContainText(`${String(invoiceNumber).padStart(6, '0')} · válida`);
    await expect(page.getByTestId('note-pdf')).toBeVisible();
  } finally {
    await prisma.companySetting.deleteMany({ where: { companyId: invoice.companyId, key: autoKey } });
    await prisma.creditNoteDocument.deleteMany({ where: { creditNote: { invoiceId: invoice.id } } });
    await prisma.simulatedSiatRecord.deleteMany({ where: { cuf: invoiceCuf } });
  }
});
