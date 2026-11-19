import {
  amountInWords,
  canResend,
  codeHealth,
  creditableOf,
  type CreditableLine,
  creditNoteActions,
  creditNoteReasonCode,
  creditNoteTotal,
  creditNoteVat,
  currentVatBookPeriod,
  integerInWords,
  fiscalDebit,
  invoiceActions,
  isCreditNoteReasonCode,
  isCreditNoteStatus,
  isDraftPeriod,
  isInvoiceCreditable,
  isInvoiceIssuable,
  isStuckSending,
  isVatBookPeriod,
  type PurchaseBookRow,
  purchaseBookTotals,
  type SalesBookRow,
  salesBookTotals,
  SIAT_CREDIT_NOTE_REASONS,
  siatCancellationReasonCode,
  validateCreditNote,
  validateInvoiceDelivery,
  validateNitExceptionRequest,
  vatBookFileName,
  vatBookPeriod,
  whatsappNumber,
  worstCodeHealth,
} from './invoicing';

const ALL = ['invoicing.invoices.view', 'invoicing.invoices.issue', 'sales.returns.manage', 'sales.cancellations.request'];

describe('invoiceActions', () => {
  it('offers nothing without the view permission', () => {
    expect(invoiceActions('VALID', ['invoicing.invoices.issue'])).toEqual([]);
  });

  it('a valid invoice can be downloaded, sent, credited and cancelled', () => {
    expect(invoiceActions('VALID', ALL)).toEqual(['VIEW_DETAIL', 'DOWNLOAD_PDF', 'DOWNLOAD_XML', 'SEND', 'ISSUE_CREDIT_NOTE', 'REQUEST_CANCELLATION']);
  });

  it('an invoice not issued can only be issued, and only by who may', () => {
    expect(invoiceActions('PENDING', ALL)).toEqual(['VIEW_DETAIL', 'ISSUE']);
    expect(invoiceActions('REJECTED', ['invoicing.invoices.view'])).toEqual(['VIEW_DETAIL']);
    expect(invoiceActions('SENDING', ALL)).toEqual(['VIEW_DETAIL']);
  });

  it('a cancelled invoice keeps its documents but allows nothing else', () => {
    expect(invoiceActions('CANCELLED', ALL)).toEqual(['VIEW_DETAIL', 'DOWNLOAD_PDF', 'DOWNLOAD_XML', 'SEND']);
  });
});

describe('canResend', () => {
  const base = { status: 'REJECTED' as const, documentType: 5, nitVerifiedAt: null, nitException: false };
  it('needs a verified NIT or an approved exception', () => {
    expect(canResend(base)).toBe(false);
    expect(canResend({ ...base, nitVerifiedAt: new Date() })).toBe(true);
    expect(canResend({ ...base, nitException: true })).toBe(true);
  });
  it('a PENDING invoice, never refused by the SIN, is sent without verification', () => {
    expect(canResend({ ...base, status: 'PENDING' })).toBe(true);
  });
  it('does not ask a CI to be verified, and only rejected or pending invoices are sent', () => {
    expect(canResend({ ...base, documentType: 1 })).toBe(true);
    expect(canResend({ ...base, status: 'VALID', nitVerifiedAt: new Date() })).toBe(false);
  });
});

describe('issuing helpers', () => {
  it('knows which invoices can be issued', () => {
    expect(isInvoiceIssuable('PENDING')).toBe(true);
    expect(isInvoiceIssuable('REJECTED')).toBe(true);
    expect(isInvoiceIssuable('VALID')).toBe(false);
  });

  it('detects a sending invoice older than the timeout', () => {
    const now = new Date('2026-11-12T12:00:00Z');
    expect(isStuckSending(new Date('2026-11-12T11:54:00Z'), now, 5)).toBe(true);
    expect(isStuckSending(new Date('2026-11-12T11:57:00Z'), now, 5)).toBe(false);
    expect(isStuckSending(null, now, 5)).toBe(true);
  });

  it('computes the 13 % fiscal debit half up', () => {
    expect(fiscalDebit('100.00').toString()).toBe('13.00');
    expect(fiscalDebit('0.50').toString()).toBe('0.07');
  });
});

describe('siatCancellationReasonCode', () => {
  it('maps the sale reasons and SIN codes, and refuses unknown ones', () => {
    expect(siatCancellationReasonCode('SIN_3')).toBe(3);
    expect(siatCancellationReasonCode('SIN_99')).toBeNull();
    expect(siatCancellationReasonCode('CUSTOMER_DATA_ERROR')).toBe(3);
    expect(siatCancellationReasonCode('OTHER')).toBe(1);
    expect(siatCancellationReasonCode('nope')).toBeNull();
  });
});

describe('validateNitExceptionRequest', () => {
  it('requires a reason of a sensible length', () => {
    expect(validateNitExceptionRequest({ reason: '   ' })).toEqual(['REASON_REQUIRED']);
    expect(validateNitExceptionRequest({ reason: 'corto' })).toEqual(['REASON_TOO_SHORT']);
    expect(validateNitExceptionRequest({ reason: 'x'.repeat(501) })).toEqual(['REASON_TOO_LONG']);
    expect(validateNitExceptionRequest({ reason: 'El cliente no recuerda su NIT exacto' })).toEqual([]);
  });
});

describe('validateInvoiceDelivery', () => {
  it('checks the e-mail and the Bolivian mobile', () => {
    expect(validateInvoiceDelivery({ channel: 'EMAIL', recipient: 'a@b.com' })).toEqual([]);
    expect(validateInvoiceDelivery({ channel: 'EMAIL', recipient: 'a@b' })).toEqual(['EMAIL_INVALID']);
    expect(validateInvoiceDelivery({ channel: 'WHATSAPP', recipient: '+591 7123 4567' })).toEqual([]);
    expect(validateInvoiceDelivery({ channel: 'WHATSAPP', recipient: '2123456' })).toEqual(['PHONE_INVALID']);
    expect(validateInvoiceDelivery({ channel: 'SMS', recipient: 'x' })).toEqual(['CHANNEL_INVALID']);
  });
  it('writes the number in international form', () => {
    expect(whatsappNumber('71234567')).toBe('59171234567');
    expect(whatsappNumber('59171234567')).toBe('59171234567');
  });
});

describe('amountInWords', () => {
  it('writes whole numbers in Spanish', () => {
    expect(integerInWords(0)).toBe('cero');
    expect(integerInWords(21)).toBe('veintiuno');
    expect(integerInWords(100)).toBe('cien');
    expect(integerInWords(101)).toBe('ciento uno');
    expect(integerInWords(1280)).toBe('mil doscientos ochenta');
    expect(integerInWords(21_000)).toBe('veintiún mil');
    expect(integerInWords(1_000_000)).toBe('un millón');
    expect(integerInWords(2_500_001)).toBe('dos millones quinientos mil uno');
  });

  it('prints the total with cents as the SIN asks', () => {
    expect(amountInWords('1280.50')).toBe('Mil doscientos ochenta 50/100 Bolivianos');
    expect(amountInWords('1.00')).toBe('Uno 00/100 Bolivianos');
    expect(amountInWords('0.07')).toBe('Cero 07/100 Bolivianos');
    expect(amountInWords('45')).toBe('Cuarenta y cinco 00/100 Bolivianos');
  });
});

describe('credit notes (HU-FAC-11, HU-FAC-12)', () => {
  const lines: CreditableLine[] = [
    { saleItemId: 'a', invoicedQuantity: 4, invoicedAmount: '980.00', creditedQuantity: 1, creditedAmount: '245.00' },
    { saleItemId: 'b', invoicedQuantity: 3, invoicedAmount: '120.00', creditedQuantity: 0, creditedAmount: '0.00' },
  ];

  it('accepts what is still creditable, pieces and money', () => {
    expect(validateCreditNote(lines, [{ saleItemId: 'a', quantity: 3, amount: '735.00' }])).toEqual([]);
    expect(validateCreditNote(lines, [{ saleItemId: 'b', quantity: 0, amount: '40.00' }])).toEqual([]);
  });

  it('refuses more than what was invoiced less what earlier notes credited', () => {
    expect(validateCreditNote(lines, [{ saleItemId: 'a', quantity: 4, amount: '100.00' }])).toEqual([
      { code: 'CREDIT_EXCEEDS_INVOICED', saleItemId: 'a', creditableQuantity: 3, creditableAmount: '735.00' },
    ]);
    expect(validateCreditNote(lines, [{ saleItemId: 'b', quantity: 0, amount: '120.01' }])[0].code).toBe('CREDIT_EXCEEDS_INVOICED');
  });

  it('counts repeated lines together', () => {
    const twice = [
      { saleItemId: 'b', quantity: 2, amount: '80.00' },
      { saleItemId: 'b', quantity: 2, amount: '40.00' },
    ];
    expect(validateCreditNote(lines, twice)).toEqual([{ code: 'CREDIT_EXCEEDS_INVOICED', saleItemId: 'b', creditableQuantity: 3, creditableAmount: '120.00' }]);
  });

  it('refuses an empty note, an unknown line, a bad quantity and a bad or zero amount', () => {
    expect(validateCreditNote(lines, [])).toEqual([{ code: 'CREDIT_EMPTY' }]);
    expect(validateCreditNote(lines, [{ saleItemId: 'zz', quantity: 1, amount: '1.00' }])).toEqual([{ code: 'SALE_ITEM_NOT_FOUND', saleItemId: 'zz' }]);
    expect(validateCreditNote(lines, [{ saleItemId: 'a', quantity: -1, amount: '1.00' }])[0].code).toBe('INVALID_QUANTITY');
    expect(validateCreditNote(lines, [{ saleItemId: 'a', quantity: 1.5, amount: '1.00' }])[0].code).toBe('INVALID_QUANTITY');
    for (const amount of ['0.00', '-5.00', '1.234', 'abc', '']) {
      expect(validateCreditNote(lines, [{ saleItemId: 'a', quantity: 1, amount }])[0].code).toBe('INVALID_AMOUNT');
    }
  });

  it('never reports a negative creditable amount', () => {
    const over = { saleItemId: 'x', invoicedQuantity: 1, invoicedAmount: '10.00', creditedQuantity: 2, creditedAmount: '12.00' };
    expect(creditableOf(over).quantity).toBe(0);
    expect(creditableOf(over).amount.toString()).toBe('0.00');
  });

  it('adds the lines and computes the 13 % VAT to adjust, half up', () => {
    expect(creditNoteTotal([{ amount: '245.00' }, { amount: '0.50' }]).toString()).toBe('245.50');
    expect(creditNoteVat('245.00').toString()).toBe('31.85');
    expect(creditNoteVat('0.50').toString()).toBe('0.07');
  });

  it('maps a return reason to the SIN catalogue, and knows its codes', () => {
    expect(creditNoteReasonCode('CUSTOMER_CHANGED_MIND')).toBe(1);
    expect(creditNoteReasonCode('FACTORY_DEFECT')).toBe(2);
    expect(creditNoteReasonCode('WRONG_PRODUCT')).toBe(3);
    expect(creditNoteReasonCode('OTHER')).toBe(5);
    expect(creditNoteReasonCode('whatever')).toBe(5);
    expect(SIAT_CREDIT_NOTE_REASONS.map((reason) => reason.code)).toEqual([1, 2, 3, 4, 5]);
    expect(isCreditNoteReasonCode(4)).toBe(true);
    expect(isCreditNoteReasonCode(9)).toBe(false);
    expect(isCreditNoteReasonCode('4')).toBe(false);
  });

  it('only a valid invoice can be credited', () => {
    expect(isInvoiceCreditable('VALID')).toBe(true);
    for (const status of ['PENDING', 'SENDING', 'REJECTED', 'CANCELLATION_PENDING', 'CANCELLED'] as const) expect(isInvoiceCreditable(status)).toBe(false);
  });

  it('offers the note actions by status and permission', () => {
    const all = ['invoicing.invoices.view', 'invoicing.notes.issue'];
    expect(creditNoteActions('PENDING', all)).toEqual(['VIEW_DETAIL', 'ISSUE', 'VOID']);
    expect(creditNoteActions('REJECTED', all)).toEqual(['VIEW_DETAIL', 'ISSUE', 'VOID']);
    expect(creditNoteActions('REJECTED', ['invoicing.invoices.view'])).toEqual(['VIEW_DETAIL']);
    expect(creditNoteActions('SENDING', all)).toEqual(['VIEW_DETAIL']);
    expect(creditNoteActions('VALID', all)).toEqual(['VIEW_DETAIL', 'DOWNLOAD_PDF', 'DOWNLOAD_XML']);
    expect(creditNoteActions('CANCELLED', all)).toEqual(['VIEW_DETAIL']);
    expect(creditNoteActions('VALID', ['invoicing.notes.issue'])).toEqual([]);
    expect(isCreditNoteStatus('VALID')).toBe(true);
    expect(isCreditNoteStatus('CANCELLATION_PENDING')).toBe(false);
  });
});

describe('codeHealth (HU-FAC-13)', () => {
  const now = new Date('2026-11-16T12:00:00Z');
  it('is expired past the date or without one, expiring inside the warning window, ok before', () => {
    expect(codeHealth(null, now, 6)).toBe('EXPIRED');
    expect(codeHealth(new Date('2026-11-16T11:59:59Z'), now, 6)).toBe('EXPIRED');
    expect(codeHealth(now, now, 6)).toBe('EXPIRED');
    expect(codeHealth('2026-11-16T18:00:00Z', now, 6)).toBe('EXPIRING');
    expect(codeHealth('2026-11-16T18:00:01Z', now, 6)).toBe('OK');
    expect(codeHealth('not a date', now, 6)).toBe('EXPIRED');
  });
  it('summarises several codes by the worst one', () => {
    expect(worstCodeHealth([])).toBe('OK');
    expect(worstCodeHealth(['OK', 'EXPIRING'])).toBe('EXPIRING');
    expect(worstCodeHealth(['OK', 'EXPIRING', 'EXPIRED'])).toBe('EXPIRED');
  });
});

describe('VAT books (HU-FAC-18, HU-FAC-19, HU-FAC-20)', () => {
  it('reads a period and its La Paz days', () => {
    expect(vatBookPeriod('2026-11')).toEqual({ year: 2026, month: 11, firstDay: '2026-11-01', lastDay: '2026-11-30' });
    expect(vatBookPeriod('2028-02')?.lastDay).toBe('2028-02-29');
    expect(vatBookPeriod('2026-13')).toBeNull();
    expect(vatBookPeriod('2026-1')).toBeNull();
    expect(isVatBookPeriod('2026-01')).toBe(true);
    expect(isVatBookPeriod(202601)).toBe(false);
  });

  it('a period is a draft until it is closed', () => {
    // 03:30 UTC on 1 Dec is still 30 Nov in La Paz
    expect(currentVatBookPeriod(new Date('2026-12-01T03:30:00Z'))).toBe('2026-11');
    expect(currentVatBookPeriod(new Date('2026-12-01T04:00:00Z'))).toBe('2026-12');
    expect(isDraftPeriod('OPEN')).toBe(true);
    expect(isDraftPeriod('CLOSED')).toBe(false);
    expect(isDraftPeriod('FILED')).toBe(false);
  });

  const sale = (over: Partial<SalesBookRow>): SalesBookRow => ({
    id: 'x',
    kind: 'INVOICE',
    date: '2026-11-10T14:00:00.000Z',
    number: 1,
    cuf: 'CUF',
    customerDocumentNumber: '1234567',
    customerName: 'Cliente',
    total: '100.00',
    fiscalDebit: '13.00',
    status: 'VALID',
    ...over,
  });

  it('adds valid invoices, ignores cancelled ones and lets credit notes reduce', () => {
    const totals = salesBookTotals([
      sale({}),
      sale({ total: '1280.00', fiscalDebit: '166.40' }),
      sale({ total: '0.00', fiscalDebit: '0.00', status: 'CANCELLED' }),
      sale({ kind: 'CREDIT_NOTE', total: '245.00', fiscalDebit: '31.85' }),
    ]);
    expect(totals).toEqual({
      invoices: 2,
      cancelled: 1,
      creditNotes: 1,
      invoicedAmount: '1380.00',
      creditedAmount: '245.00',
      netAmount: '1135.00',
      fiscalDebit: '147.55',
    });
    expect(salesBookTotals([])).toMatchObject({ invoices: 0, invoicedAmount: '0.00', fiscalDebit: '0.00' });
  });

  const purchase = (over: Partial<PurchaseBookRow>): PurchaseBookRow => ({
    id: 'p',
    date: '2026-11-05',
    supplierNit: '1020304050',
    supplierName: 'Proveedor',
    authorizationCode: 'AUTH',
    invoiceNumber: '15',
    total: '200.00',
    vatCredit: '26.00',
    status: 'VALID',
    observation: null,
    nitVerifiedAt: null,
    ...over,
  });

  it('an observed purchase is counted apart and does not add tax credit', () => {
    expect(purchaseBookTotals([purchase({}), purchase({ total: '500.00', vatCredit: '65.00', status: 'OBSERVED' })])).toEqual({
      entries: 2,
      observed: 1,
      totalAmount: '200.00',
      vatCredit: '26.00',
      observedAmount: '500.00',
      observedVatCredit: '65.00',
    });
  });

  it('names the exported file, with BORRADOR while the period is open', () => {
    expect(vatBookFileName('SALES', '2026-11', 'XLSX', true)).toBe('libro-ventas-2026-11-BORRADOR.xlsx');
    expect(vatBookFileName('PURCHASES', '2026-10', 'CSV', false)).toBe('libro-compras-2026-10.csv');
  });
});
