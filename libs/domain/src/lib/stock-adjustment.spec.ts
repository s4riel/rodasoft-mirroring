import {
  adjustmentDelta,
  AdjustmentError,
  adjustmentTotalValue,
  assertStockChanges,
  buildAdjustmentMovement,
  formatAdjustmentNumber,
  needsApproval,
  parseAdjustmentNumber,
  parseAdjustmentPaste,
  resolveAdjustment,
  validateAdjustmentDraft,
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

describe('validateAdjustmentDraft', () => {
  const lines = [{ productId: 'p1', kind: 'IN' as const, quantity: 2 }];

  it('returns the reason and the trimmed note', () => {
    expect(validateAdjustmentDraft({ reason: 'DAMAGE', note: '  wet box ', lines })).toEqual({ reason: 'DAMAGE', note: 'wet box' });
    expect(validateAdjustmentDraft({ reason: 'DAMAGE', note: '  ', lines }).note).toBeNull();
  });

  it('requires a reason, and a note for "Otro"', () => {
    expect(() => validateAdjustmentDraft({ reason: undefined, lines })).toThrow(expect.objectContaining({ code: 'REASON_REQUIRED' }));
    expect(() => validateAdjustmentDraft({ reason: 'OTHER', note: ' ', lines })).toThrow(expect.objectContaining({ code: 'REASON_NOTE_REQUIRED' }));
  });

  it('requires at least one line and refuses a product twice', () => {
    expect(() => validateAdjustmentDraft({ reason: 'DAMAGE', lines: [] })).toThrow(expect.objectContaining({ code: 'ADJUSTMENT_EMPTY' }));
    expect(() => validateAdjustmentDraft({ reason: 'DAMAGE', lines: [...lines, { productId: 'p1', kind: 'OUT', quantity: 1 }] })).toThrow(
      expect.objectContaining({ code: 'DUPLICATE_LINE' }),
    );
  });

  it('needs at least 1 piece for IN and OUT, and allows a count of 0', () => {
    expect(() => validateAdjustmentDraft({ reason: 'DAMAGE', lines: [{ productId: 'p1', kind: 'OUT', quantity: 0 }] })).toThrow(RangeError);
    expect(() => validateAdjustmentDraft({ reason: 'DAMAGE', lines: [{ productId: 'p1', kind: 'COUNT', quantity: 0 }] })).not.toThrow();
    expect(() => validateAdjustmentDraft({ reason: 'DAMAGE', lines: [{ productId: 'p1', kind: 'IN', quantity: 1.5 }] })).toThrow(RangeError);
  });
});

describe('adjustmentDelta', () => {
  it('adds, takes out, or moves the stock to the counted quantity', () => {
    expect(adjustmentDelta({ kind: 'IN', quantity: 4, balance: 10 })).toBe(4);
    expect(adjustmentDelta({ kind: 'OUT', quantity: 4, balance: 10 })).toBe(-4);
    expect(adjustmentDelta({ kind: 'COUNT', quantity: 7, balance: 10 })).toBe(-3);
    expect(adjustmentDelta({ kind: 'COUNT', quantity: 12, balance: 10 })).toBe(2);
  });

  it('gives 0 for a count equal to the balance', () => {
    expect(adjustmentDelta({ kind: 'COUNT', quantity: 10, balance: 10 })).toBe(0);
  });
});

describe('assertStockChanges', () => {
  it('refuses a document where every line is 0', () => {
    expect(() => assertStockChanges([0, 0])).toThrow(expect.objectContaining({ code: 'NO_STOCK_CHANGE' }));
    expect(() => assertStockChanges([0, -1])).not.toThrow();
  });
});

describe('adjustmentTotalValue', () => {
  it('sums |delta| × cost without float drift', () => {
    expect(
      adjustmentTotalValue([
        { delta: 3, unitCost: '0.1000' },
        { delta: -7, unitCost: '0.2000' },
      ]),
    ).toBe('1.70');
  });

  it('counts a line without cost as 0', () => {
    expect(adjustmentTotalValue([{ delta: 5, unitCost: null }])).toBe('0.00');
    expect(adjustmentTotalValue([])).toBe('0.00');
  });
});

describe('parseAdjustmentPaste', () => {
  it('reads code, quantity and an optional kind, and takes OUT when the kind is left out', () => {
    const { rows, errors } = parseAdjustmentPaste('6204-2RS, 3\n6205-ZZ; 5; Entrada\n6206\t0\tconteo');
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { line: 1, code: '6204-2RS', quantity: 3, kind: 'OUT' },
      { line: 2, code: '6205-ZZ', quantity: 5, kind: 'IN' },
      { line: 3, code: '6206', quantity: 0, kind: 'COUNT' },
    ]);
  });

  it('skips blank lines and a header row, with or without a kind column', () => {
    expect(parseAdjustmentPaste('Código, Cantidad, Tipo\n\nA-1, 2').rows).toEqual([{ line: 3, code: 'A-1', quantity: 2, kind: 'OUT' }]);
  });

  it('accepts the kind in English, without accents and in any case', () => {
    expect(parseAdjustmentPaste('A,1,IN\nB,1,Out\nC,1,COUNT').rows.map((r) => r.kind)).toEqual(['IN', 'OUT', 'COUNT']);
  });

  it('reports what it cannot read and keeps going', () => {
    const { rows, errors } = parseAdjustmentPaste(',3\nA-1\nA-2, x\nA-3, 0\nA-4, 2, Cambio\nA-5, 1');
    expect(rows).toEqual([{ line: 6, code: 'A-5', quantity: 1, kind: 'OUT' }]);
    expect(errors.map((e) => [e.line, e.reason])).toEqual([
      [1, 'MISSING_CODE'],
      [2, 'MISSING_QUANTITY'],
      [3, 'INVALID_QUANTITY'],
      [4, 'INVALID_QUANTITY'],
      [5, 'INVALID_KIND'],
    ]);
  });

  it('sums a repeated in or out code and refuses any other repetition', () => {
    const { rows, errors } = parseAdjustmentPaste('A-1, 2\na-1, 3\nB-1, 4, Conteo\nB-1, 5, Conteo\nC-1, 1, Entrada\nC-1, 1');
    expect(rows).toEqual([
      { line: 1, code: 'A-1', quantity: 5, kind: 'OUT' },
      { line: 3, code: 'B-1', quantity: 4, kind: 'COUNT' },
      { line: 5, code: 'C-1', quantity: 1, kind: 'IN' },
    ]);
    expect(errors.map((e) => [e.line, e.reason])).toEqual([
      [4, 'DUPLICATE_CODE'],
      [6, 'DUPLICATE_CODE'],
    ]);
  });
});
