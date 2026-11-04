import { IdentityDocumentType, isNitFormatValid, normalizeNit, validateInvoiceDocument } from './nit';

describe('NIT', () => {
  it('normaliza y valida el formato', () => {
    expect(normalizeNit('1020 304-078')).toBe('1020304078');
    expect(isNitFormatValid('1020304078')).toBe(true);
    expect(isNitFormatValid('12a45')).toBe(false);
    expect(isNitFormatValid('0000000')).toBe(false);
    expect(isNitFormatValid('123')).toBe(false);
  });
});

describe('validateInvoiceDocument', () => {
  const { NIT, CI, CEX, PAS, OD } = IdentityDocumentType;

  it('accepts a NIT and returns it normalized', () => {
    expect(validateInvoiceDocument(NIT, '1020 304-078')).toEqual({ valid: true, documentNumber: '1020304078', complement: null });
  });

  it('refuses a malformed NIT, an all-zero NIT and an empty one', () => {
    expect(validateInvoiceDocument(NIT, '12a45')).toEqual({ valid: false, error: 'FORMAT' });
    expect(validateInvoiceDocument(NIT, '0')).toEqual({ valid: false, error: 'FORMAT' });
    expect(validateInvoiceDocument(NIT, '123')).toEqual({ valid: false, error: 'FORMAT' });
    expect(validateInvoiceDocument(NIT, '  ')).toEqual({ valid: false, error: 'REQUIRED' });
  });

  it('accepts a CI with an optional complement, and only a CI', () => {
    expect(validateInvoiceDocument(CI, '4567890', '1a')).toEqual({ valid: true, documentNumber: '4567890', complement: '1A' });
    expect(validateInvoiceDocument(CI, '4567890')).toMatchObject({ valid: true, complement: null });
    expect(validateInvoiceDocument(CI, '4567890', 'ABC')).toEqual({ valid: false, error: 'COMPLEMENT' });
    expect(validateInvoiceDocument(NIT, '1020304078', '1A')).toEqual({ valid: false, error: 'COMPLEMENT' });
    expect(validateInvoiceDocument(CI, '45A7890')).toEqual({ valid: false, error: 'FORMAT' });
  });

  it('accepts alphanumeric foreign ID, passport and other documents', () => {
    expect(validateInvoiceDocument(CEX, 'e-1234567')).toMatchObject({ valid: true, documentNumber: 'E1234567' });
    expect(validateInvoiceDocument(PAS, 'ab123456')).toMatchObject({ valid: true, documentNumber: 'AB123456' });
    expect(validateInvoiceDocument(OD, 'X1')).toEqual({ valid: false, error: 'FORMAT' });
  });

  it('refuses an unknown document type', () => {
    expect(validateInvoiceDocument(99, '12345678')).toEqual({ valid: false, error: 'FORMAT' });
  });
});
