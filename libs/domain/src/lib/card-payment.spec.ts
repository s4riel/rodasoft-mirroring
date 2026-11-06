import { CARD_DECLINE_REASONS, isCardDeclineReason, normalizeAuthorizationCode } from './card-payment';

describe('normalizeAuthorizationCode', () => {
  it('trims and upper-cases the code', () => {
    expect(normalizeAuthorizationCode('  a1b2c3 ')).toEqual({ ok: true, code: 'A1B2C3' });
  });

  it('accepts the shortest and the longest valid code', () => {
    expect(normalizeAuthorizationCode('AB12').ok).toBe(true);
    expect(normalizeAuthorizationCode('ABCDEF123456').ok).toBe(true);
  });

  it.each(['', '   ', 'AB1', 'ABCDEF1234567', 'AB-123', 'AB 123', 'ÁB123'])('refuses %j', (text) => {
    expect(normalizeAuthorizationCode(text)).toEqual({ ok: false, error: 'INVALID_AUTHORIZATION_CODE' });
  });
});

describe('isCardDeclineReason', () => {
  it('accepts every listed reason', () => {
    for (const reason of CARD_DECLINE_REASONS) expect(isCardDeclineReason(reason)).toBe(true);
  });

  it('refuses anything else', () => {
    expect(isCardDeclineReason('NO_MONEY')).toBe(false);
    expect(isCardDeclineReason(undefined)).toBe(false);
    expect(isCardDeclineReason(3)).toBe(false);
  });
});
