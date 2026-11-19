/**
 * Integration test of the credit note issuing (HU-FAC-12) against the real Postgres: acceptance, rejection, an unavailable SIAT
 * (back to PENDING, nothing scheduled), a note whose invoice is not valid, consecutive numbers under concurrency, and recovery of
 * a lost attempt.
 */
import { PrismaClient } from '@prisma/client';
import { InMemorySiatStore, SimulatedSiatGateway, type SimulatorMode } from '@rodasoft/siat';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../common/prisma.service';
import { CreditNoteIssueService } from './credit-note-issue.service';
import { InvoiceIssueService } from './invoice-issue.service';

const prisma = new PrismaClient();
const service = new CreditNoteIssueService(prisma as unknown as PrismaService);
const invoices = new InvoiceIssueService(prisma as unknown as PrismaService);
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

/** A sale with its invoice (issued unless `issueInvoice` is false) and a PENDING credit note of one of its two pieces. */
async function seedNote(options: { customerNit?: string; pos?: string | null; issueInvoice?: boolean; nitException?: boolean } = {}) {
  const { customerNit = '1234567', issueInvoice = true, nitException = false } = options;
  const pos = options.pos === undefined ? pointOfSaleId : options.pos;
  const n = ++counter;
  const warehouse = await prisma.warehouse.findFirstOrThrow({ where: { companyId } });
  const sale = await prisma.sale.create({
    data: {
      companyId,
      number: `V-${run}-${n}`,
      branchId,
      warehouseId: warehouse.id,
      origin: 'ORDER',
      status: 'COMPLETED',
      subtotal: '100.00',
      total: '100.00',
      createdById: userId,
      items: { create: [{ companyId, productId, quantity: 2, unitPrice: '50.00', lineTotal: '100.00' }] },
    },
    include: { items: true },
  });
  const invoice = await prisma.invoice.create({
    data: {
      companyId,
      saleId: sale.id,
      branchId,
      pointOfSaleId,
      status: 'PENDING',
      total: '100.00',
      customerTaxName: 'Cliente de prueba',
      customerDocumentType: 5,
      customerDocumentNumber: customerNit,
      nitException,
    },
  });
  if (issueInvoice) await invoices.issue({ invoiceId: invoice.id, companyId, manual: false, userId: null }, gateway);
  const note = await prisma.creditNote.create({
    data: {
      companyId,
      invoiceId: invoice.id,
      branchId,
      pointOfSaleId: pos,
      status: 'PENDING',
      total: '50.00',
      vatAdjusted: '6.50',
      reasonCode: 2,
      customerTaxName: 'Cliente de prueba',
      customerDocumentType: 5,
      customerDocumentNumber: customerNit,
      items: { create: [{ companyId, saleItemId: sale.items[0].id, description: 'Rodamiento 6205', quantity: 1, unitPrice: '50.00', amount: '50.00' }] },
    },
  });
  return { note, invoice };
}

const issue = (creditNoteId: string, manual = false) => service.issue({ creditNoteId, companyId, manual, userId: null }, gateway);
const noteRow = (id: string) => prisma.creditNote.findUniqueOrThrow({ where: { id }, include: { document: true } });

describe('CreditNoteIssueService (integration, real Postgres)', () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { slug: `note-${run}`, legalName: `Note ${run} S.R.L.`, tradeName: `Note ${run}`, nit } });
    companyId = company.id;
    const branch = await prisma.branch.create({ data: { companyId, code: 0, name: 'Central' } });
    branchId = branch.id;
    await prisma.warehouse.create({ data: { companyId, branchId, code: 'T-01', name: 'Main', isMain: true } });
    pointOfSaleId = (await prisma.siatPointOfSale.create({ data: { companyId, branchId, code: 0, name: 'Caja 1' } })).id;
    const brand = await prisma.brand.create({ data: { companyId, name: 'B' } });
    const category = await prisma.category.create({ data: { companyId, name: 'C' } });
    productId = (await prisma.product.create({ data: { companyId, sku: `N-${run}`, manufacturerCode: 'X1', brandId: brand.id, categoryId: category.id, name: 'Rodamiento 6205', salePrice: '50.00' } })).id;
    userId = (await prisma.user.create({ data: { email: `note-${run}@test.local`, name: 'Cajero', passwordHash: 'x' } })).id;
  });

  // one simulated SIN per file: the notes need the invoices it accepted earlier
  const store = new InMemorySiatStore();
  beforeEach(() => {
    mode = 'ONLINE';
    gateway = new SimulatedSiatGateway(() => mode, store);
  });

  afterAll(async () => {
    const where = { companyId };
    await prisma.auditLog.deleteMany({ where });
    await prisma.creditNoteDocument.deleteMany({ where });
    await prisma.creditNote.deleteMany({ where });
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
    await prisma.user.deleteMany({ where: { email: `note-${run}@test.local` } });
    await prisma.company.delete({ where: { id: companyId } });
    await prisma.$disconnect();
  });

  it('accepts a note: VALID with its own number series, CUF, reception code, document and audit trail', async () => {
    const { note, invoice } = await seedNote();
    expect(await issue(note.id)).toBe('ACCEPTED');

    const saved = await noteRow(note.id);
    const original = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(saved).toMatchObject({ status: 'VALID', number: 1, lastError: null, rejectionCode: null });
    expect(saved.cuf).toMatch(/^[0-9A-F]+SIM0$/);
    expect(saved.cuf).not.toBe(original.cuf);
    expect(saved.siatReceptionCode).toMatch(/^SIM-NC-/);
    expect(saved.issuedAt).not.toBeNull();
    expect(saved.document?.signedXml).toContain('<numeroNotaCreditoDebito>1</numeroNotaCreditoDebito>');
    expect(saved.document?.signedXml).toContain(`<numeroAutorizacionCuf>${original.cuf}</numeroAutorizacionCuf>`);
    expect(saved.document?.signedXml).toContain('<montoTotalDevuelto>50.00</montoTotalDevuelto>');
    expect(saved.document?.signedXml).toContain('<codigoMotivo>2</codigoMotivo>');
    const actions = (await prisma.auditLog.findMany({ where: { companyId, entity: 'CreditNote', entityId: note.id }, orderBy: { id: 'asc' } })).map((a) => a.action);
    expect(actions).toEqual(['invoicing.note.issue', 'invoicing.note.accept']);
    // the note series is apart from the invoice series
    const keys = await prisma.documentSequence.findMany({ where: { companyId }, select: { key: true } });
    expect(keys.map((k) => k.key).sort()).toEqual(['INV-0-0', 'NC-0-0']);
  });

  it('does nothing twice: a VALID note, or one a person is already sending, is skipped', async () => {
    const { note } = await seedNote();
    expect(await issue(note.id)).toBe('ACCEPTED');
    expect(await issue(note.id)).toBe('SKIPPED');
    const sending = await seedNote();
    await prisma.creditNote.update({ where: { id: sending.note.id }, data: { status: 'SENDING' } });
    expect(await issue(sending.note.id)).toBe('SKIPPED');
  });

  it('rejects an unknown NIT: REJECTED with the SIN code and message, number kept, no document', async () => {
    // the invoice went with an approved exception; the note of a different (unknown) NIT does not
    const { note, invoice } = await seedNote({ customerNit: '9991234', nitException: true });
    await prisma.invoice.update({ where: { id: invoice.id }, data: { nitException: false } });
    expect(await issue(note.id)).toBe('REJECTED');
    const saved = await noteRow(note.id);
    expect(saved).toMatchObject({ status: 'REJECTED', rejectionCode: 1037, rejectionMessage: 'NIT INVALIDO' });
    expect(saved.number).not.toBeNull();
    expect(saved.document).toBeNull();
  });

  it('an unavailable SIAT sends the note back to PENDING, keeps its number, and leaves no outbox event behind', async () => {
    const { note } = await seedNote();
    const before = await prisma.outboxEvent.count({ where: { companyId } });
    mode = 'OFFLINE';
    expect(await issue(note.id)).toBe('UNAVAILABLE');
    const saved = await noteRow(note.id);
    expect(saved).toMatchObject({ status: 'PENDING', lastError: 'SIAT_UNAVAILABLE' });
    expect(saved.number).not.toBeNull();
    expect(await prisma.outboxEvent.count({ where: { companyId } })).toBe(before);

    // the SIAT is back: a person issues it and it keeps the same number
    mode = 'ONLINE';
    expect(await issue(note.id)).toBe('ACCEPTED');
    expect(await noteRow(note.id)).toMatchObject({ status: 'VALID', number: saved.number, lastError: null });
  });

  it('a note whose invoice the SIAT has not validated stays PENDING without a number, and says why', async () => {
    const { note } = await seedNote({ issueInvoice: false });
    expect(await issue(note.id)).toBe('UNAVAILABLE');
    expect(await noteRow(note.id)).toMatchObject({ status: 'PENDING', lastError: 'INVOICE_NOT_VALID', number: null, cuf: null });
  });

  it('a note without a point of sale stays PENDING and says why', async () => {
    const { note } = await seedNote({ pos: null });
    expect(await issue(note.id)).toBe('UNAVAILABLE');
    expect(await noteRow(note.id)).toMatchObject({ status: 'PENDING', lastError: 'POINT_OF_SALE_MISSING', number: null });
  });

  it('with homologation required, a note of a product without SIN code stays PENDING with PRODUCT_NOT_HOMOLOGATED', async () => {
    const { note } = await seedNote();
    await prisma.companySetting.create({ data: { companyId, key: 'invoicing.requireHomologation', value: true } });
    try {
      expect(await issue(note.id)).toBe('UNAVAILABLE');
      expect(await noteRow(note.id)).toMatchObject({ status: 'PENDING', lastError: 'PRODUCT_NOT_HOMOLOGATED', number: null, cuf: null });
      await prisma.product.update({ where: { id: productId }, data: { sinProductCode: '84821' } });
      expect(await issue(note.id)).toBe('ACCEPTED');
    } finally {
      await prisma.product.update({ where: { id: productId }, data: { sinProductCode: null } });
      await prisma.companySetting.deleteMany({ where: { companyId, key: 'invoicing.requireHomologation' } });
    }
  });

  it('concurrent first sends on one point of sale take consecutive numbers, with no gap or duplicate', async () => {
    const seeded = [];
    for (let i = 0; i < 6; i++) seeded.push(await seedNote());
    const outcomes = await Promise.all(seeded.map(({ note }) => issue(note.id)));
    expect(outcomes.every((o) => o === 'ACCEPTED')).toBe(true);
    const numbers = (await prisma.creditNote.findMany({ where: { id: { in: seeded.map(({ note }) => note.id) } }, select: { number: true } }))
      .map((row) => row.number as number)
      .sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(6);
    expect(numbers[5] - numbers[0]).toBe(5);
  });

  it('two concurrent attempts on one note make one attempt with one number', async () => {
    const { note } = await seedNote();
    const outcomes = await Promise.all([issue(note.id), issue(note.id)]);
    expect(outcomes.filter((o) => o === 'ACCEPTED')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'SKIPPED')).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { companyId, entityId: note.id, action: 'invoicing.note.issue' } })).toBe(1);
  });

  it('recovers a SENDING note whose attempt reached the SIAT: it finishes it without sending again', async () => {
    const { note } = await seedNote();
    expect(await issue(note.id)).toBe('ACCEPTED');
    const accepted = await noteRow(note.id);
    // simulate the crash: the SIAT has it, the local row went back to SENDING
    await prisma.creditNote.update({ where: { id: note.id }, data: { status: 'SENDING', siatReceptionCode: null } });
    expect(await issue(note.id, true)).toBe('ACCEPTED');
    const recovered = await noteRow(note.id);
    expect(recovered).toMatchObject({ status: 'VALID', cuf: accepted.cuf, number: accepted.number });
    expect(recovered.issuedAt?.getTime()).toBe(accepted.issuedAt?.getTime());
  });
});
