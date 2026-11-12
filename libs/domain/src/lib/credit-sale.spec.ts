import { CREDIT_MAX_TERM_DAYS, creditDueDate, creditEligibility, validateCreditTerm } from './credit-sale';
import { IdentityDocumentType } from './nit';

describe('creditEligibility', () => {
  const nitCustomer = { creditEnabled: true, documentType: IdentityDocumentType.NIT };

  it('accepts an identified customer with a NIT and the flag on', () => {
    expect(creditEligibility(nitCustomer)).toEqual({ ok: true });
  });

  it('needs a customer', () => {
    expect(creditEligibility(null)).toEqual({ ok: false, reason: 'CUSTOMER_REQUIRED' });
    expect(creditEligibility(undefined)).toEqual({ ok: false, reason: 'CUSTOMER_REQUIRED' });
  });

  it('needs the credit flag', () => {
    expect(creditEligibility({ ...nitCustomer, creditEnabled: false })).toEqual({ ok: false, reason: 'CREDIT_NOT_ENABLED' });
  });

  it('needs a NIT, not another document', () => {
    expect(creditEligibility({ ...nitCustomer, documentType: IdentityDocumentType.CI })).toEqual({ ok: false, reason: 'NIT_REQUIRED' });
  });

  it('checks the flag before the document', () => {
    expect(creditEligibility({ creditEnabled: false, documentType: IdentityDocumentType.CI })).toEqual({
      ok: false,
      reason: 'CREDIT_NOT_ENABLED',
    });
  });
});

describe('validateCreditTerm', () => {
  it('accepts whole days from 1 to the maximum', () => {
    expect(validateCreditTerm(1)).toBe(true);
    expect(validateCreditTerm(30)).toBe(true);
    expect(validateCreditTerm(CREDIT_MAX_TERM_DAYS)).toBe(true);
  });

  it('refuses zero, negatives, fractions, too long terms and non-numbers', () => {
    for (const bad of [0, -5, 1.5, CREDIT_MAX_TERM_DAYS + 1, NaN, '30', null, undefined]) expect(validateCreditTerm(bad)).toBe(false);
  });
});

describe('creditDueDate', () => {
  it('adds the term to the La Paz day', () => {
    expect(creditDueDate('2026-11-12', 5)).toBe('2026-11-17');
    expect(creditDueDate('2026-11-12', 30)).toBe('2026-12-12');
  });

  it('crosses month and year ends', () => {
    expect(creditDueDate('2026-01-30', 1)).toBe('2026-01-31');
    expect(creditDueDate('2026-01-31', 30)).toBe('2026-03-02');
    expect(creditDueDate('2026-12-20', 15)).toBe('2027-01-04');
    expect(creditDueDate('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('refuses an invalid term', () => {
    expect(() => creditDueDate('2026-11-12', 0)).toThrow();
  });
});
