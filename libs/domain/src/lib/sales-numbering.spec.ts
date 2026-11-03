import {
  formatDispatchNumber,
  formatOrderNumber,
  formatQuoteNumber,
  formatReturnNumber,
  formatSaleNumber,
  parseSalesDocumentNumber,
  SALE_REF_TYPE,
} from './sales-numbering';

describe('sales document numbers', () => {
  it('formats every series with six digits', () => {
    expect(formatSaleNumber(231)).toBe('V-000231');
    expect(formatQuoteNumber(12)).toBe('COT-000012');
    expect(formatOrderNumber(12)).toBe('PED-000012');
    expect(formatDispatchNumber(12)).toBe('DSP-000012');
    expect(formatReturnNumber(12)).toBe('DEV-000012');
  });

  it('keeps growing past six digits', () => {
    expect(formatSaleNumber(1234567)).toBe('V-1234567');
  });

  it('reads the sequence back, and only from its own series', () => {
    expect(parseSalesDocumentNumber('sale', 'V-000231')).toBe(231);
    expect(parseSalesDocumentNumber('sale', 'COT-000231')).toBeNull();
    expect(parseSalesDocumentNumber('sale', 'V-12a')).toBeNull();
  });

  it('names the reference type of the sale movements', () => {
    expect(SALE_REF_TYPE).toBe('SALE');
  });
});
