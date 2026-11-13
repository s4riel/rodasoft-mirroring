import { amountInWords, canResend, integerInWords, fiscalDebit, invoiceActions, isInvoiceIssuable, isStuckSending, siatCancellationReasonCode, validateInvoiceDelivery, validateNitExceptionRequest, whatsappNumber } from './invoicing';

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
