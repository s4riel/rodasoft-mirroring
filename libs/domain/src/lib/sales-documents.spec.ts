import {
  addDaysToDay,
  effectiveQuoteStatus,
  isQuoteConvertible,
  quoteDefaultValidUntil,
  quoteValidityError,
  releasableQuantity,
  reservationShortfalls,
} from './sales-documents';

describe('quote validity', () => {
  it('adds days across months and leap years', () => {
    expect(addDaysToDay('2026-12-28', 7)).toBe('2027-01-04');
    expect(addDaysToDay('2028-02-27', 2)).toBe('2028-02-29');
  });
  it('defaults to today plus the company days', () => {
    expect(quoteDefaultValidUntil('2026-11-07', 7)).toBe('2026-11-14');
  });
  it('rejects a past, impossible or too distant day', () => {
    expect(quoteValidityError('2026-11-06', '2026-11-07')).toBe('IN_PAST');
    expect(quoteValidityError('2026-11-07', '2026-11-07')).toBeNull();
    expect(quoteValidityError('2026-02-30', '2026-11-07')).toBe('INVALID_DATE');
    expect(quoteValidityError('nope', '2026-11-07')).toBe('INVALID_DATE');
    expect(quoteValidityError('2028-01-01', '2026-11-07')).toBe('TOO_FAR');
  });
});

describe('quote status', () => {
  it('reads a sent quote past its day as expired, and nothing else', () => {
    expect(effectiveQuoteStatus('SENT', '2026-11-06', '2026-11-07')).toBe('EXPIRED');
    expect(effectiveQuoteStatus('SENT', '2026-11-07', '2026-11-07')).toBe('SENT');
    expect(effectiveQuoteStatus('DRAFT', '2026-01-01', '2026-11-07')).toBe('DRAFT');
  });
  it('converts a draft or a sent quote that is still valid', () => {
    expect(isQuoteConvertible('DRAFT', '2026-11-07', '2026-11-07')).toBe(true);
    expect(isQuoteConvertible('SENT', '2026-11-08', '2026-11-07')).toBe(true);
    expect(isQuoteConvertible('SENT', '2026-11-06', '2026-11-07')).toBe(false);
    for (const status of ['ACCEPTED', 'EXPIRED', 'REJECTED'] as const) {
      expect(isQuoteConvertible(status, '2027-01-01', '2026-11-07')).toBe(false);
    }
  });
});

describe('reservations', () => {
  const levels = new Map([
    ['a', { quantity: 10, reserved: 4 }],
    ['b', { quantity: 3, reserved: 0 }],
  ]);
  it('lists each product that cannot be reserved in full, adding repeated lines', () => {
    expect(
      reservationShortfalls(
        [
          { productId: 'a', quantity: 4 },
          { productId: 'a', quantity: 3 },
          { productId: 'b', quantity: 3 },
          { productId: 'c', quantity: 1 },
        ],
        levels,
      ),
    ).toEqual([
      { productId: 'a', requested: 7, available: 6 },
      { productId: 'c', requested: 1, available: 0 },
    ]);
  });
  it('is never short with negative stock allowed', () => {
    expect(reservationShortfalls([{ productId: 'c', quantity: 9 }], levels, true)).toEqual([]);
  });
  it('releases only what was reserved and not dispatched', () => {
    expect(releasableQuantity({ reservedQuantity: 5, dispatchedQuantity: 2 })).toBe(3);
    expect(releasableQuantity({ reservedQuantity: 2, dispatchedQuantity: 5 })).toBe(0);
  });
});
