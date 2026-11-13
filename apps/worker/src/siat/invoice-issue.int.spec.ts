/**
 * Integration test of the invoice issuing (HU-FAC-01…10) against the real Postgres: acceptance, rejection, an unavailable SIAT
 * (back to PENDING, nothing scheduled), consecutive numbers under concurrency, and recovery of a lost attempt.
 */
import { PrismaClient } from '@prisma/client';
import { InMemorySiatStore, SimulatedSiatGateway, type SimulatorMode } from '@rodasoft/siat';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../common/prisma.service';
import { InvoiceIssueService } from './invoice-issue.service';

const prisma = new PrismaClient();
const service = new InvoiceIssueService(prisma as unknown as PrismaService);
const run = randomUUID().slice(0, 8);
const nit = String(Math.floor(1e9 + Math.random() * 8e9));

let companyId: string;
let branchId: string;
let pointOfSaleId: string;
let productId: string;
let userId: string;
let mode: SimulatorMode = 'ONLINE';
let gateway: SimulatedSiatGateway;
let counter = 0;

/** A completed sale with its PENDING invoice, as `pos-payment.service` leaves it. */
async function seedInvoice(customerNit = '1234567', pos: string | null = pointOfSaleId) {
  const n = ++counter;
  const warehouse = await prisma.warehouse.findFirstOrThrow({ where: { companyId } });
  const sale = await prisma.sale.create({
    data: {
      companyId,
      number: `V-${run}-${n}`,
      branchId,
      warehouseId: warehouse.id,
      // an order dispatch needs no checkout or shift
      origin: 'ORDER',
      status: 'COMPLETED',
      subtotal: '100.00',
      total: '100.00',
      createdById: userId,
      items: { create: [{ companyId, productId, quantity: 2, unitPrice: '50.00', lineTotal: '100.00' }] },
    },
  });
  return prisma.invoice.create({
    data: {
      companyId,
      saleId: sale.id,
      branchId,
      pointOfSaleId: pos,
      status: 'PENDING',
      total: '100.00',
      customerTaxName: 'Cliente de prueba',
      customerDocumentType: 5,
      customerDocumentNumber: customerNit,
    },
  });
}

const issue = (invoiceId: string, manual = false) => service.issue({ invoiceId, companyId, manual, userId: null }, gateway);

describe('InvoiceIssueService (integration, real Postgres)', () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { slug: `issue-${run}`, legalName: `Issue ${run} S.R.L.`, tradeName: `Issue ${run}`, nit } });
    companyId = company.id;
    const branch = await prisma.branch.create({ data: { companyId, code: 0, name: 'Central' } });
    branchId = branch.id;
    await prisma.warehouse.create({ data: { companyId, branchId, code: 'T-01', name: 'Main', isMain: true } });
    pointOfSaleId = (await prisma.siatPointOfSale.create({ data: { companyId, branchId, code: 0, name: 'Caja 1' } })).id;
    const brand = await prisma.brand.create({ data: { companyId, name: 'B' } });
    const category = await prisma.category.create({ data: { companyId, name: 'C' } });
    productId = (await prisma.product.create({ data: { companyId, sku: `T-${run}`, manufacturerCode: 'X1', brandId: brand.id, categoryId: category.id, name: 'Rodamiento 6205', salePrice: '50.00' } })).id;
    userId = (await prisma.user.create({ data: { email: `issue-${run}@test.local`, name: 'Cajero', passwordHash: 'x' } })).id;
  });

  beforeEach(() => {
    mode = 'ONLINE';
    gateway = new SimulatedSiatGateway(() => mode, new InMemorySiatStore());
  });

  afterAll(async () => {
    const where = { companyId };
    await prisma.auditLog.deleteMany({ where });
    await prisma.invoiceDocument.deleteMany({ where });
    await prisma.invoice.deleteMany({ where });
    await prisma.saleItem.deleteMany({ where });
    await prisma.sale.deleteMany({ where });
    await prisma.$executeRaw`DELETE FROM document_sequences WHERE company_id = ${companyId}::uuid`;
    await prisma.product.deleteMany({ where });
    await prisma.brand.deleteMany({ where });
    await prisma.category.deleteMany({ where });
    await prisma.siatPointOfSale.deleteMany({ where });
    await prisma.warehouse.deleteMany({ where });
    await prisma.branch.deleteMany({ where });
    await prisma.user.deleteMany({ where: { email: `issue-${run}@test.local` } });
    await prisma.company.delete({ where: { id: companyId } });
    await prisma.$disconnect();
  });

  it('accepts an invoice: VALID with number, CUF, reception code, signed document and an audit trail', async () => {
    const invoice = await seedInvoice();
    expect(await issue(invoice.id)).toBe('ACCEPTED');

    const saved = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { document: true } });
    expect(saved).toMatchObject({ status: 'VALID', number: 1, lastError: null, rejectionCode: null });
    expect(saved.cuf).toMatch(/^[0-9A-F]+SIM0$/);
    expect(saved.siatReceptionCode).toMatch(/^SIM-/);
    expect(saved.issuedAt).not.toBeNull();
    expect(saved.document?.signedXml).toContain('<numeroFactura>1</numeroFactura>');
    expect(saved.document?.signedXml).toContain('Rodamiento 6205');
    const actions = (await prisma.auditLog.findMany({ where: { companyId, entityId: invoice.id }, orderBy: { id: 'asc' } })).map((a) => a.action);
    expect(actions).toEqual(['invoicing.invoice.issue', 'invoicing.invoice.accept']);
  });

  it('does nothing twice: a VALID invoice, or one a person is already sending, is skipped', async () => {
    const invoice = await seedInvoice();
    expect(await issue(invoice.id)).toBe('ACCEPTED');
    expect(await issue(invoice.id)).toBe('SKIPPED');
    const sending = await seedInvoice();
    await prisma.invoice.update({ where: { id: sending.id }, data: { status: 'SENDING' } });
    expect(await issue(sending.id)).toBe('SKIPPED');
  });

  it('rejects an unknown NIT: REJECTED with the SIN code and message, number kept', async () => {
    const invoice = await seedInvoice('9991234');
    expect(await issue(invoice.id)).toBe('REJECTED');
    const saved = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { document: true } });
    expect(saved).toMatchObject({ status: 'REJECTED', rejectionCode: 1037, rejectionMessage: 'NIT INVALIDO' });
    expect(saved.number).not.toBeNull();
    expect(saved.document).toBeNull();
  });

  it('an unavailable SIAT sends the invoice back to PENDING, keeps its number, and leaves no outbox event behind', async () => {
    const before = await prisma.outboxEvent.count({ where: { companyId } });
    mode = 'OFFLINE';
    const invoice = await seedInvoice();
    expect(await issue(invoice.id)).toBe('UNAVAILABLE');
    const saved = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(saved).toMatchObject({ status: 'PENDING', lastError: 'SIAT_UNAVAILABLE' });
    expect(saved.number).not.toBeNull();
    expect(await prisma.outboxEvent.count({ where: { companyId } })).toBe(before);

    // the SIAT is back: a person issues it and it keeps the same number
    mode = 'ONLINE';
    expect(await issue(invoice.id)).toBe('ACCEPTED');
    const issued = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(issued).toMatchObject({ status: 'VALID', number: saved.number, lastError: null });
  });

  it('a company without a point of sale leaves the invoice PENDING and says why', async () => {
    const invoice = await seedInvoice('1234567', null);
    expect(await issue(invoice.id)).toBe('UNAVAILABLE');
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).toMatchObject({ status: 'PENDING', lastError: 'POINT_OF_SALE_MISSING', number: null });
  });

  it('concurrent first sends on one point of sale take consecutive numbers, with no gap or duplicate', async () => {
    const invoices = await Promise.all(Array.from({ length: 6 }, () => seedInvoice()));
    const outcomes = await Promise.all(invoices.map((i) => issue(i.id)));
    expect(outcomes.every((o) => o === 'ACCEPTED')).toBe(true);
    const numbers = (await prisma.invoice.findMany({ where: { id: { in: invoices.map((i) => i.id) } }, select: { number: true } })).map((i) => i.number as number).sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(6);
    expect(numbers[5] - numbers[0]).toBe(5);
  });

  it('two concurrent attempts on one invoice make one attempt with one number', async () => {
    const invoice = await seedInvoice();
    const outcomes = await Promise.all([issue(invoice.id), issue(invoice.id)]);
    expect(outcomes.filter((o) => o === 'ACCEPTED')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'SKIPPED')).toHaveLength(1);
    const audits = await prisma.auditLog.count({ where: { companyId, entityId: invoice.id, action: 'invoicing.invoice.issue' } });
    expect(audits).toBe(1);
  });

  it('recovers a SENDING invoice whose attempt reached the SIAT: it finishes it without sending again', async () => {
    const invoice = await seedInvoice();
    expect(await issue(invoice.id)).toBe('ACCEPTED');
    const accepted = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    // simulate the crash: the SIAT has it, the local row went back to SENDING
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'SENDING', siatReceptionCode: null } });
    expect(await issue(invoice.id, true)).toBe('ACCEPTED');
    const recovered = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(recovered).toMatchObject({ status: 'VALID', cuf: accepted.cuf, number: accepted.number });
    expect(recovered.issuedAt?.getTime()).toBe(accepted.issuedAt?.getTime());
  });
});
