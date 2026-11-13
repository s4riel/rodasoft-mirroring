import { PrismaClient } from '@prisma/client';
import { expect, test } from '@playwright/test';
import { login } from './support/auth';
import { invoiceOfSale, resetAdminShifts, sellableCode, sellOne } from './support/invoicing';

/**
 * HU-FAC-09, HU-FAC-10 · a valid invoice is cancelled: the request is made from the invoice with a SIN reason, Management finds
 * it in the invoicing inbox, and approving cancels the invoice in the SIAT first and only then the sale (stock back, refund).
 * The test makes the sale in the POS and turns its invoice VALID with a simulated SIAT record. The administrator holds both
 * permissions, so the same user asks and approves. Needs the demo data from `pnpm db:seed`.
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

test('the cancellation asked from a valid invoice reaches the inbox and, once approved, cancels the invoice in the SIAT and the sale', async ({ page }) => {
  await login(page);
  const number = await sellOne(page, code);
  const invoice = await invoiceOfSale(prisma, number);
  const cuf = `E2E${Date.now()}SIM0`;
  const issuedAt = new Date();
  const invoiceNumber = 900000 + (Date.now() % 90000);
  const invoiceLabel = String(invoiceNumber).padStart(6, '0');
  await prisma.simulatedSiatRecord.create({ data: { cuf, companyId: invoice.companyId, receptionCode: 'SIM-E2E' } });
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { status: 'VALID', number: invoiceNumber, cuf, issuedAt, siatReceptionCode: 'SIM-E2E', lastError: null },
  });

  try {
    // ask from the invoice: reason and comment are required
    await page.goto(`/invoicing/invoices/${invoice.id}`);
    await page.getByTestId('invoice-cancel').click();
    const dialog = page.getByRole('dialog', { name: /Solicitar anulación de la factura/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('invoice-cancellation-send')).toBeDisabled();
    await dialog.getByRole('button', { name: 'Error en datos del cliente' }).click();
    await expect(dialog).toContainText('Datos de emisión incorrectos');
    await dialog.locator('#invoice-cancellation-comment').fill('La factura salió con el NIT de otro cliente');
    await dialog.getByTestId('invoice-cancellation-send').click();
    await expect(dialog).toHaveCount(0);

    // still valid in the SIAT until Management decides
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id }, select: { status: true } })).status).toBe('VALID');

    // Management finds it in the invoicing inbox and reviews the sale
    await page.goto('/invoicing/cancellations');
    const row = page.locator('rs-doc-table tbody tr').filter({ hasText: invoiceLabel });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Datos de emisión incorrectos');
    await expect(row).toContainText('Por aprobar');
    await row.getByRole('link', { name: 'Revisar' }).click();
    await expect(page.getByRole('heading', { name: `Aprobar anulación · Venta ${number}` })).toBeVisible();

    // approving: the SIAT cancels first, then the sale and the invoice are cancelled together
    await page.getByTestId('review-approve').click();
    await page.getByTestId('review-approve-confirm').click();
    await expect(page.getByRole('heading', { name: `Venta ${number}`, exact: true })).toBeVisible();
    await expect(page.locator('rs-status-pill', { hasText: 'Anulada' }).first()).toBeVisible();

    const cancelled = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id }, select: { status: true, cancelledAt: true, cancellationReasonCode: true } });
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancelledAt).not.toBeNull();
    expect(cancelled.cancellationReasonCode).not.toBeNull();
    const record = await prisma.simulatedSiatRecord.findUniqueOrThrow({ where: { cuf }, select: { cancelledAt: true } });
    expect(record.cancelledAt).not.toBeNull();

    // the invoice list shows it cancelled
    await page.goto(`/invoicing/invoices/${invoice.id}`);
    await expect(page.locator('rs-status-pill', { hasText: 'Anulada' }).first()).toBeVisible();
  } finally {
    await prisma.simulatedSiatRecord.deleteMany({ where: { cuf } });
  }
});
