import { customerDiscountInputValid, describeCustomerDiscount, FINAL_CONSUMER } from './customer';
import { IdentityDocumentType, validateInvoiceDocument } from './nit';

describe('FINAL_CONSUMER', () => {
  it('is NIT 0 with the name S/N (decision #4)', () => {
    expect(FINAL_CONSUMER).toMatchObject({ documentType: IdentityDocumentType.NIT, documentNumber: '0', name: 'S/N' });
  });

  it('is not something a customer can be registered as', () => {
    expect(validateInvoiceDocument(FINAL_CONSUMER.documentType, FINAL_CONSUMER.documentNumber).valid).toBe(false);
  });
});

describe('customerDiscountInputValid', () => {
  it('NONE carries no value', () => {
    expect(customerDiscountInputValid('NONE', '0')).toBe(true);
    expect(customerDiscountInputValid('NONE', '0.00')).toBe(true);
    expect(customerDiscountInputValid('NONE', '5')).toBe(false);
  });

  it('a percent is above 0 and at most 100', () => {
    expect(customerDiscountInputValid('PERCENT', '10')).toBe(true);
    expect(customerDiscountInputValid('PERCENT', '100')).toBe(true);
    expect(customerDiscountInputValid('PERCENT', '100.01')).toBe(false);
    expect(customerDiscountInputValid('PERCENT', '0')).toBe(false);
    expect(customerDiscountInputValid('PERCENT', '-5')).toBe(false);
  });

  it('a fixed amount is positive and has no upper limit (the total never goes below 0 anyway)', () => {
    expect(customerDiscountInputValid('AMOUNT', '15.50')).toBe(true);
    expect(customerDiscountInputValid('AMOUNT', '100000')).toBe(true);
    expect(customerDiscountInputValid('AMOUNT', '0')).toBe(false);
    expect(customerDiscountInputValid('AMOUNT', '-1')).toBe(false);
  });

  it('refuses text that is not a number and unknown types', () => {
    expect(customerDiscountInputValid('PERCENT', 'abc')).toBe(false);
    expect(customerDiscountInputValid('PERCENT', '')).toBe(false);
    expect(customerDiscountInputValid('OTHER' as never, '5')).toBe(false);
  });
});

describe('describeCustomerDiscount', () => {
  it('describes each kind as data', () => {
    expect(describeCustomerDiscount('NONE', '0')).toEqual({ kind: 'NONE' });
    expect(describeCustomerDiscount('PERCENT', '10')).toEqual({ kind: 'PERCENT', value: '10.00' });
    expect(describeCustomerDiscount('AMOUNT', '15.5')).toEqual({ kind: 'AMOUNT', value: '15.50' });
  });
});
