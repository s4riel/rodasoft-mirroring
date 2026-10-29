import {
  applyReceiptSession,
  assertTransferLineCount,
  assertTransferWarehouses,
  computeTransferDifferences,
  formatTransferNumber,
  isTransferEditable,
  nextReceiptEvent,
  parseTransferNumber,
  parseTransferPaste,
  totalDifferenceValue,
  TransferError,
  validateSurplus,
  validateTransferLines,
} from './transfer';

describe('transfer numbers', () => {
  it('formats and parses the TR series', () => {
    expect(formatTransferNumber(123)).toBe('TR-000123');
    expect(parseTransferNumber('TR-000123')).toBe(123);
    expect(parseTransferNumber('AJ-000123')).toBeNull();
  });
});

describe('assertTransferWarehouses', () => {
  const a = { id: 'a', active: true };
  const b = { id: 'b', active: true };

  it('accepts two different active warehouses', () => {
    expect(() => assertTransferWarehouses(a, b)).not.toThrow();
  });

  it('refuses the same warehouse', () => {
    expect(() => assertTransferWarehouses(a, a)).toThrow(expect.objectContaining({ code: 'SAME_WAREHOUSE' }));
  });

  it('refuses an inactive warehouse on either side', () => {
    expect(() => assertTransferWarehouses({ ...a, active: false }, b)).toThrow(expect.objectContaining({ code: 'WAREHOUSE_INACTIVE' }));
    expect(() => assertTransferWarehouses(a, { ...b, active: false })).toThrow(TransferError);
  });
});

describe('assertTransferLineCount', () => {
  it('allows up to the limit and refuses above it', () => {
    expect(() => assertTransferLineCount(500, 500)).not.toThrow();
    expect(() => assertTransferLineCount(501, 500)).toThrow(expect.objectContaining({ code: 'TOO_MANY_LINES' }));
  });
});

describe('validateTransferLines', () => {
  const available = new Map([
    ['p1', 10],
    ['p2', 2],
    ['p3', 100],
  ]);

  it('flags every kind of error and keeps the line', () => {
    const { lines, summary } = validateTransferLines(
      [
        { productId: 'p1', quantity: 10, unitCost: '1.5000', active: true },
        { productId: 'p2', quantity: 3, unitCost: '2.0000', active: true },
        { productId: 'p3', quantity: 0, unitCost: '1.0000', active: true },
        { productId: 'p3', quantity: 5, unitCost: '1.0000', active: false },
        { productId: 'p9', quantity: 1, unitCost: null, active: true },
      ],
      available,
    );
    expect(lines.map((l) => l.status)).toEqual(['OK', 'INSUFFICIENT_STOCK', 'INVALID_QUANTITY', 'PRODUCT_INACTIVE', 'INSUFFICIENT_STOCK']);
    expect(lines[1].available).toBe(2);
    expect(summary.errors).toBe(4);
    expect(summary.products).toBe(5);
  });

  it('totals pieces and value at cost with exact decimals', () => {
    const { summary } = validateTransferLines(
      [
        { productId: 'p1', quantity: 3, unitCost: '10.3333', active: true },
        { productId: 'p2', quantity: 2, unitCost: null, active: true },
      ],
      available,
    );
    expect(summary.pieces).toBe(5);
    expect(summary.value).toBe('31.00');
    expect(summary.withoutCost).toBe(1);
    expect(summary.errors).toBe(0);
  });

  it('does not count an invalid quantity in the pieces or the value', () => {
    const { summary } = validateTransferLines([{ productId: 'p1', quantity: 1.5, unitCost: '9.0000', active: true }], available);
    expect(summary).toMatchObject({ pieces: 0, value: '0.00', errors: 1 });
  });
});

describe('isTransferEditable', () => {
  it('only a draft can change', () => {
    expect(isTransferEditable('DRAFT')).toBe(true);
    expect(isTransferEditable('IN_TRANSIT')).toBe(false);
  });
});

describe('parseTransferPaste', () => {
  it('reads comma, tab and semicolon separators', () => {
    const { rows, errors } = parseTransferPaste('6204-2RS, 5\n6205\t10\n6206;3');
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { line: 1, code: '6204-2RS', quantity: 5 },
      { line: 2, code: '6205', quantity: 10 },
      { line: 3, code: '6206', quantity: 3 },
    ]);
  });

  it('drops the quotes Excel puts around the cells of a CSV', () => {
    const { rows, errors } = parseTransferPaste('"Código","Cantidad"\r\n"6204-2RS","5"\r\n"6205"; "2"');
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { line: 2, code: '6204-2RS', quantity: 5 },
      { line: 3, code: '6205', quantity: 2 },
    ]);
  });

  it('skips a header row and blank lines', () => {
    const { rows, errors } = parseTransferPaste('Código;Cantidad\r\n\r\n6204,2\n   \n');
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ line: 3, code: '6204', quantity: 2 }]);
  });

  it('reports a missing code, a missing quantity and a quantity that is not a whole number above zero', () => {
    const { rows, errors } = parseTransferPaste(',4\n6204\n6205,0\n6206,-2\n6207,1.5\n6208,abc');
    expect(rows).toEqual([]);
    expect(errors.map((e) => [e.line, e.reason])).toEqual([
      [1, 'MISSING_CODE'],
      [2, 'MISSING_QUANTITY'],
      [3, 'INVALID_QUANTITY'],
      [4, 'INVALID_QUANTITY'],
      [5, 'INVALID_QUANTITY'],
      [6, 'INVALID_QUANTITY'],
    ]);
  });

  it('sums a repeated code into its first line, ignoring case', () => {
    const { rows } = parseTransferPaste('6204,2\n6205,1\n6204-x,1\n6204,3');
    expect(rows).toEqual([
      { line: 1, code: '6204', quantity: 5 },
      { line: 2, code: '6205', quantity: 1 },
      { line: 3, code: '6204-x', quantity: 1 },
    ]);
  });
});

describe('receipt sessions (HU-INV-21)', () => {
  const lines = [
    { productId: 'a', sent: 10, received: 0, unitCost: '5.0000' },
    { productId: 'b', sent: 4, received: 1, unitCost: null },
  ];
  const codeOf = (fn: () => unknown) => {
    try {
      fn();
      return null;
    } catch (err) {
      return err instanceof TransferError ? err.code : 'OTHER';
    }
  };

  it('adds what was counted now to what each line already received', () => {
    expect(applyReceiptSession(lines, [{ productId: 'a', quantity: 6 }, { productId: 'b', quantity: 0 }])).toEqual([
      { productId: 'a', quantity: 6, received: 6 },
    ]);
  });

  it('refuses a line above what was sent, counting earlier sessions', () => {
    expect(codeOf(() => applyReceiptSession(lines, [{ productId: 'a', quantity: 11 }]))).toBe('RECEIPT_EXCEEDS_SENT');
    expect(codeOf(() => applyReceiptSession(lines, [{ productId: 'b', quantity: 4 }]))).toBe('RECEIPT_EXCEEDS_SENT');
    expect(applyReceiptSession(lines, [{ productId: 'b', quantity: 3 }])).toEqual([{ productId: 'b', quantity: 3, received: 4 }]);
  });

  it('refuses an empty session, unknown products, negative or repeated counts', () => {
    expect(codeOf(() => applyReceiptSession(lines, []))).toBe('RECEIPT_EMPTY');
    expect(codeOf(() => applyReceiptSession(lines, [{ productId: 'a', quantity: 0 }]))).toBe('RECEIPT_EMPTY');
    expect(codeOf(() => applyReceiptSession(lines, [{ productId: 'zzz', quantity: 1 }]))).toBe('RECEIPT_LINE_INVALID');
    expect(codeOf(() => applyReceiptSession(lines, [{ productId: 'a', quantity: -1 }]))).toBe('RECEIPT_LINE_INVALID');
    expect(codeOf(() => applyReceiptSession(lines, [{ productId: 'a', quantity: 1.5 }]))).toBe('RECEIPT_LINE_INVALID');
    expect(codeOf(() => applyReceiptSession(lines, [{ productId: 'a', quantity: 1 }, { productId: 'a', quantity: 1 }]))).toBe('RECEIPT_LINE_INVALID');
  });

  it('completes the transfer only when every line is received in full', () => {
    expect(nextReceiptEvent([{ sent: 10, received: 6 }, { sent: 4, received: 4 }])).toBe('receivePartial');
    expect(nextReceiptEvent([{ sent: 10, received: 10 }, { sent: 4, received: 4 }])).toBe('receiveAll');
  });

  it('accepts a surplus only on a line received in full', () => {
    const closing = [
      { productId: 'a', sent: 10, received: 8, unitCost: '5.0000' },
      { productId: 'b', sent: 10, received: 10, unitCost: '2.5000' },
    ];
    expect(validateSurplus(closing, [{ productId: 'b', quantity: 2 }, { productId: 'a', quantity: 0 }])).toEqual(new Map([['b', 2]]));
    expect(codeOf(() => validateSurplus(closing, [{ productId: 'a', quantity: 1 }]))).toBe('SURPLUS_NOT_ALLOWED');
    expect(codeOf(() => validateSurplus(closing, [{ productId: 'zzz', quantity: 1 }]))).toBe('RECEIPT_LINE_INVALID');
  });
});

describe('computeTransferDifferences', () => {
  it('values shortages and surplus with Decimal and skips the lines that matched', () => {
    const differences = computeTransferDifferences([
      { productId: 'a', sent: 10, received: 8, surplus: 0, unitCost: '5.0000' },
      { productId: 'b', sent: 10, received: 10, surplus: 2, unitCost: '1.2345' },
      { productId: 'c', sent: 3, received: 3, surplus: 0, unitCost: '9.0000' },
      { productId: 'd', sent: 5, received: 0, surplus: 0, unitCost: null },
    ]);
    expect(differences).toEqual([
      { productId: 'a', kind: 'SHORTAGE', quantity: -2, unitCost: '5.0000', value: '10.00' },
      { productId: 'b', kind: 'SURPLUS', quantity: 2, unitCost: '1.2345', value: '2.47' },
      { productId: 'd', kind: 'SHORTAGE', quantity: -5, unitCost: null, value: '0.00' },
    ]);
    expect(totalDifferenceValue(differences)).toBe('12.47');
  });

  it('has no differences when everything matched', () => {
    expect(computeTransferDifferences([{ productId: 'a', sent: 1, received: 1, surplus: 0, unitCost: '1.0000' }])).toEqual([]);
  });
});
