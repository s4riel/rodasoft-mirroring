import { defaultKardexRange, kardexCounterpartText, kardexDocumentLink, kardexDocumentRoute, kardexRangeError, kardexValue, laPazToday, movementPill, STOCK_MOVEMENT_TYPE_LABELS } from './kardex';
import { STOCK_MOVEMENT_TYPES } from './stock';

describe('defaultKardexRange', () => {
  it('is the whole current month', () => {
    expect(defaultKardexRange(new Date('2026-10-15T15:00:00Z'))).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('uses the La Paz day: 02:00 UTC on 1 Nov is still 31 Oct in La Paz', () => {
    expect(defaultKardexRange(new Date('2026-11-01T02:00:00Z'))).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('starts the next month at La Paz midnight (04:00 UTC)', () => {
    expect(defaultKardexRange(new Date('2026-11-01T04:00:00Z'))).toEqual({ from: '2026-11-01', to: '2026-11-30' });
  });

  it('knows the length of February, leap years included', () => {
    expect(defaultKardexRange(new Date('2027-02-10T12:00:00Z')).to).toBe('2027-02-28');
    expect(defaultKardexRange(new Date('2028-02-10T12:00:00Z')).to).toBe('2028-02-29');
  });

  it('crosses the year boundary', () => {
    expect(defaultKardexRange(new Date('2027-01-01T03:59:00Z'))).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});

describe('laPazToday', () => {
  it('is the La Paz calendar day', () => {
    expect(laPazToday(new Date('2026-10-29T03:59:00Z'))).toBe('2026-10-28');
    expect(laPazToday(new Date('2026-10-29T04:00:00Z'))).toBe('2026-10-29');
  });
});

describe('kardexRangeError', () => {
  it('accepts a normal range and a single day', () => {
    expect(kardexRangeError({ from: '2026-10-01', to: '2026-10-31' })).toBeNull();
    expect(kardexRangeError({ from: '2026-10-05', to: '2026-10-05' })).toBeNull();
  });

  it('refuses from after to', () => {
    expect(kardexRangeError({ from: '2026-10-31', to: '2026-10-01' })).toBe('FROM_AFTER_TO');
  });

  it('allows 366 days and refuses 367', () => {
    expect(kardexRangeError({ from: '2026-01-01', to: '2026-12-31' })).toBeNull();
    expect(kardexRangeError({ from: '2028-01-01', to: '2028-12-31' })).toBeNull(); // leap year: 366 days
    expect(kardexRangeError({ from: '2026-01-01', to: '2027-01-02' })).toBe('RANGE_TOO_LONG');
  });

  it('refuses days that are not dates', () => {
    expect(kardexRangeError({ from: '2026-13-01', to: '2026-12-31' })).toBe('INVALID_DATE');
    expect(kardexRangeError({ from: 'yesterday', to: '2026-12-31' })).toBe('INVALID_DATE');
    expect(kardexRangeError({ from: '2026-02-31', to: '2026-03-10' })).toBe('INVALID_DATE');
    expect(kardexRangeError({ from: '2026-03-01', to: '2026-04-31' })).toBe('INVALID_DATE');
  });
});

describe('kardexValue', () => {
  it('multiplies pieces by the unit cost and rounds to cents', () => {
    expect(kardexValue(10, '12.5000')).toBe('125.00');
    expect(kardexValue(3, '0.3333')).toBe('1.00');
    expect(kardexValue(3, '0.3350')).toBe('1.01');
  });

  it('has no value without a unit cost, and a zero cost is a real zero', () => {
    expect(kardexValue(10, null)).toBeNull();
    expect(kardexValue(10, '0.0000')).toBe('0.00');
  });

  it('keeps the sign of the quantity', () => {
    expect(kardexValue(-4, '2.5000')).toBe('-10.00');
  });
});

describe('STOCK_MOVEMENT_TYPE_LABELS', () => {
  it('labels every movement type', () => {
    for (const type of STOCK_MOVEMENT_TYPES) expect(STOCK_MOVEMENT_TYPE_LABELS[type]).toBeTruthy();
    expect(Object.keys(STOCK_MOVEMENT_TYPE_LABELS).sort()).toEqual([...STOCK_MOVEMENT_TYPES].sort());
  });
});

describe('movementPill', () => {
  it('gives transfers their own pill and the rest an inflow or outflow by sign', () => {
    expect(movementPill('TRANSFER_OUT', -5)).toBe('TRANSFER');
    expect(movementPill('TRANSFER_IN', 5)).toBe('TRANSFER');
    expect(movementPill('PURCHASE_RECEIPT', 30)).toBe('IN');
    expect(movementPill('SALE', -6)).toBe('OUT');
    expect(movementPill('ADJUSTMENT_OUT', -1)).toBe('OUT');
    expect(movementPill('ADJUSTMENT_IN', 2)).toBe('IN');
    expect(movementPill('INITIAL', 10)).toBe('IN');
  });
});

describe('kardexCounterpartText', () => {
  it('says where the pieces go or come from and whether they are still on the way', () => {
    expect(kardexCounterpartText({ direction: 'TO', branch: 'Sacaba', warehouse: 'Principal', inTransit: true })).toBe('Hacia Sacaba · Principal · en tránsito');
    expect(kardexCounterpartText({ direction: 'FROM', branch: 'Huayna Kapac', warehouse: 'Principal', inTransit: false })).toBe('Desde Huayna Kapac · Principal');
  });
});

describe('kardexDocumentLink and kardexDocumentRoute', () => {
  it('links a transfer or its receipt to the transfer, and an adjustment document to itself', () => {
    expect(kardexDocumentLink('TRANSFER', 't1', 't1')).toEqual({ kind: 'TRANSFER', id: 't1' });
    expect(kardexDocumentLink('TRANSFER_RECEIPT', 't1', 'r1')).toEqual({ kind: 'TRANSFER', id: 't1' });
    expect(kardexDocumentLink('ADJUSTMENT', null, 'a1')).toEqual({ kind: 'ADJUSTMENT', id: 'a1' });
    expect(kardexDocumentRoute({ kind: 'TRANSFER', id: 't1' })).toBe('/inventory/transfers/t1');
    expect(kardexDocumentRoute({ kind: 'ADJUSTMENT', id: 'a1' })).toBe('/inventory/adjustments/a1');
  });

  it('has no link for a quick adjustment, a sale or a movement without document', () => {
    expect(kardexDocumentLink('ADJUSTMENT', null, null)).toBeNull();
    expect(kardexDocumentLink('SALE', null, 's1')).toBeNull();
    expect(kardexDocumentLink(null, null, null)).toBeNull();
  });
});
