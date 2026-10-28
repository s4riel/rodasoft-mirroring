import {
  AdjustmentError,
  buildAdjustmentMovement,
  formatAdjustmentNumber,
  needsApproval,
  parseAdjustmentNumber,
  resolveAdjustment,
} from './stock-adjustment';

describe('buildAdjustmentMovement', () => {
  it('signs the quantity by direction and picks the movement type', () => {
    expect(buildAdjustmentMovement({ direction: 'IN', quantity: 3, reason: 'COUNT_ERROR' })).toEqual({
      type: 'ADJUSTMENT_IN',
      signedQuantity: 3,
      reasonText: 'Error de conteo',
    });
    expect(buildAdjustmentMovement({ direction: 'OUT', quantity: 2, reason: 'SHRINKAGE' })).toEqual({
      type: 'ADJUSTMENT_OUT',
      signedQuantity: -2,
      reasonText: 'Merma',
    });
  });

  it('appends the note to the reason label', () => {
    expect(buildAdjustmentMovement({ direction: 'OUT', quantity: 1, reason: 'DAMAGE', note: '  caja rota ' }).reasonText).toBe(
      'Daño: caja rota',
    );
  });

  it('requires a reason', () => {
    expect(() => buildAdjustmentMovement({ direction: 'IN', quantity: 1, reason: undefined })).toThrow(
      expect.objectContaining({ code: 'REASON_REQUIRED' }),
    );
  });

  it('requires a note for OTHER', () => {
    const attempt = () => buildAdjustmentMovement({ direction: 'IN', quantity: 1, reason: 'OTHER', note: '   ' });
    expect(attempt).toThrow(AdjustmentError);
    expect(attempt).toThrow(expect.objectContaining({ code: 'REASON_NOTE_REQUIRED' }));
    expect(buildAdjustmentMovement({ direction: 'IN', quantity: 1, reason: 'OTHER', note: 'regalo' }).reasonText).toBe('Otro: regalo');
  });

  it('rejects a quantity that is not a whole number of at least 1', () => {
    for (const quantity of [0, -1, 1.5]) {
      expect(() => buildAdjustmentMovement({ direction: 'IN', quantity, reason: 'DAMAGE' })).toThrow(RangeError);
    }
  });
});

describe('resolveAdjustment', () => {
  it('keeps IN and OUT as given', () => {
    expect(resolveAdjustment({ kind: 'OUT', quantity: 3, balance: 24 })).toEqual({ direction: 'OUT', quantity: 3 });
    expect(resolveAdjustment({ kind: 'IN', quantity: 2, balance: 0 })).toEqual({ direction: 'IN', quantity: 2 });
  });

  it('turns a count into the difference with the balance', () => {
    expect(resolveAdjustment({ kind: 'COUNT', quantity: 20, balance: 24 })).toEqual({ direction: 'OUT', quantity: 4 });
    expect(resolveAdjustment({ kind: 'COUNT', quantity: 30, balance: 24 })).toEqual({ direction: 'IN', quantity: 6 });
    expect(resolveAdjustment({ kind: 'COUNT', quantity: 0, balance: 5 })).toEqual({ direction: 'OUT', quantity: 5 });
  });

  it('refuses a count equal to the balance', () => {
    expect(() => resolveAdjustment({ kind: 'COUNT', quantity: 24, balance: 24 })).toThrow(
      expect.objectContaining({ code: 'NO_STOCK_CHANGE' }),
    );
  });

  it('refuses quantities that are not whole numbers in range', () => {
    expect(() => resolveAdjustment({ kind: 'IN', quantity: 0, balance: 5 })).toThrow(RangeError);
    expect(() => resolveAdjustment({ kind: 'OUT', quantity: 1.5, balance: 5 })).toThrow(RangeError);
    expect(() => resolveAdjustment({ kind: 'COUNT', quantity: -1, balance: 5 })).toThrow(RangeError);
  });
});

describe('needsApproval', () => {
  it('compares quantity × cost with the limit, strictly', () => {
    expect(needsApproval(10, '5.0000', '49.99')).toBe(true);
    expect(needsApproval(10, '5.0000', '50.00')).toBe(false);
    expect(needsApproval(10, '5.0000', '50.01')).toBe(false);
  });

  it('never asks without a limit or without a cost', () => {
    expect(needsApproval(1_000, '99.0000', null)).toBe(false);
    expect(needsApproval(1_000, null, '1.00')).toBe(false);
  });

  it('values the absolute quantity', () => {
    expect(needsApproval(-10, '5.0000', '49.99')).toBe(true);
  });
});

describe('adjustment numbers', () => {
  it('formats and parses the sequence', () => {
    expect(formatAdjustmentNumber(123)).toBe('AJ-000123');
    expect(parseAdjustmentNumber('AJ-000123')).toBe(123);
    expect(parseAdjustmentNumber('AJ-1234567')).toBe(1_234_567);
    expect(parseAdjustmentNumber('AJ-0015')).toBe(15);
    expect(parseAdjustmentNumber('AJ-')).toBeNull();
    expect(parseAdjustmentNumber('V-000123')).toBeNull();
  });
});
