import type { CreditNoteListItem } from '@rodasoft/domain';
import {
  bookDate,
  codeExpiryLabel,
  documentNumberLabel,
  noteHistoryLabel,
  noteMenuFor,
  noteOriginLabel,
  noteRangeLabel,
  periodLabel,
  periodOptions,
  toNoteQuery,
  toNoteRow,
  toPurchaseRow,
  toSalesBookRow,
} from './credit-note-format';

const note = (over: Partial<CreditNoteListItem> = {}): CreditNoteListItem => ({
  id: 'n1',
  number: 45,
  status: 'VALID',
  invoiceId: 'i1',
  invoiceNumber: 1528,
  customerName: 'Industrias Demo S.A.',
  returnId: 'r1',
  returnNumber: 'DEV-000012',
  total: '245.00',
  issuedAt: '2026-11-14T16:06:00.000Z',
  createdAt: '2026-11-14T16:05:00.000Z',
  branchId: 'b1',
  rejectionMessage: null,
  actions: ['VIEW_DETAIL', 'DOWNLOAD_PDF'],
  ...over,
});

describe('credit note formatting (FS-23, FS-05, FS-08, FS-10)', () => {
  it('prints numbers with six digits, or a dash while the SIAT has not numbered them', () => {
    expect(documentNumberLabel(45)).toBe('000045');
    expect(documentNumberLabel(null)).toBe('—');
  });

  it('names where a note comes from', () => {
    expect(noteOriginLabel(note())).toBe('Devolución DEV-000012');
    expect(noteOriginLabel(note({ returnNumber: null }))).toBe('Ajuste de precio');
  });

  it('builds the table row with the Spanish status pill', () => {
    const row = toNoteRow(note());
    expect(row.cells).toMatchObject({ number: '000045', customer: 'Industrias Demo S.A.', invoice: '001528', origin: 'Devolución DEV-000012', total: 'Bs 245,00' });
    expect(row.cells['status']).toMatchObject({ label: 'Válida', status: 'success' });
    expect(toNoteRow(note({ status: 'PENDING', number: null })).cells['status']).toMatchObject({ label: 'No emitida en SIAT', status: 'warning' });
  });

  it('turns the actions the API allows into the row menu, in order', () => {
    expect(noteMenuFor({ actions: ['VIEW_DETAIL', 'ISSUE', 'VOID'] }).map((i) => i.key)).toEqual(['view', 'issue', 'void']);
    expect(noteMenuFor({ actions: [] })).toEqual([]);
  });

  it('builds the list query from the url filters and leaves empty ones out', () => {
    expect(toNoteQuery({ q: '', status: null, from: null, to: null, branchId: null, page: 2 })).toEqual({
      q: undefined,
      status: undefined,
      from: undefined,
      to: undefined,
      branchId: undefined,
      page: 2,
      pageSize: 10,
    });
    expect(toNoteQuery({ q: 'DEV', status: 'VALID', from: '2026-11-01', to: null, branchId: 'b1', page: 1 })).toMatchObject({ q: 'DEV', status: 'VALID', from: '2026-11-01', branchId: 'b1' });
  });

  it('writes the range and the history lines', () => {
    expect(noteRangeLabel(1, 3, 3)).toBe('1–3 de 3 notas');
    expect(noteRangeLabel(2, 1, 11)).toBe('11–11 de 11 notas');
    expect(noteRangeLabel(1, 0, 0)).toBe('');
    expect(noteHistoryLabel('invoicing.note.accept')).toBe('Validada por el SIAT');
    expect(noteHistoryLabel('other')).toBe('other');
  });

  it('says when a point of sale has no code', () => {
    expect(codeExpiryLabel(null, false)).toBe('Sin código');
    expect(codeExpiryLabel('2026-11-14T16:06:00.000Z', true)).toContain('14/11');
  });

  it('names periods and offers the last twelve, the open one first', () => {
    expect(periodLabel('2026-11')).toBe('Noviembre 2026');
    const options = periodOptions('2026-02');
    expect(options).toHaveLength(12);
    expect(options[0]).toEqual({ value: '2026-02', label: 'Febrero 2026 · abierto' });
    expect(options[2].value).toBe('2025-12');
    expect(bookDate('2026-11-05')).toBe('05/11/2026');
  });

  it('shows a credit note in the sales book with a minus sign, and an observed purchase with no credit', () => {
    const sale = toSalesBookRow({ id: 'x', kind: 'CREDIT_NOTE', date: '2026-11-10T14:00:00.000Z', number: 3, cuf: 'C', customerDocumentNumber: '123', customerName: 'Cliente', total: '200.00', fiscalDebit: '26.00', status: 'VALID' });
    expect(sale.cells).toMatchObject({ number: 'NC 000003', total: '−Bs 200,00', debit: '−Bs 26,00' });
    const purchase = toPurchaseRow({
      id: 'p',
      date: '2026-10-08',
      supplierNit: '1020304132',
      supplierName: 'Embalajes',
      authorizationCode: 'A',
      invoiceNumber: '000221',
      total: '1200.00',
      vatCredit: '156.00',
      status: 'OBSERVED',
      observation: null,
      nitVerifiedAt: null,
    });
    expect(purchase.cells).toMatchObject({ date: '08/10/2026', credit: '—', supplier: 'Embalajes · 1020304132' });
    expect(purchase.cells['status']).toMatchObject({ label: 'Observada', status: 'danger' });
  });
});
