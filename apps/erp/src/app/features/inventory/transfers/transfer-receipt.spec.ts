import {
  canHaveSurplus,
  differencesOf,
  errorOf,
  filterLines,
  pageCountOf,
  pageOf,
  ReceiptLineState,
  receiveAll,
  receiveLine,
  setCounted,
  summarize,
  toSessionLines,
  toSurplusLines,
} from './transfer-receipt';

const line = (over: Partial<ReceiptLineState> = {}): ReceiptLineState => ({
  productId: 'p1',
  code: '6204-2RS',
  name: 'Rodamiento',
  brand: 'SKF',
  sent: 10,
  received: 0,
  counted: 0,
  unitCost: '5.0000',
  ...over,
});

describe('transfer receipt lines', () => {
  it('"Todo" counts the pending pieces of a line, and "Recibir todo" of every line', () => {
    const lines = [line({ productId: 'a', sent: 10, received: 4 }), line({ productId: 'b', sent: 3 })];
    expect(receiveLine(lines, 'a').map((l) => l.counted)).toEqual([6, 0]);
    expect(receiveAll(lines).map((l) => l.counted)).toEqual([6, 3]);
  });

  it('flags a count that is not a whole number or goes above what is pending', () => {
    expect(errorOf(line({ counted: 4 }))).toBeNull();
    expect(errorOf(line({ counted: 10 }))).toBeNull();
    expect(errorOf(line({ counted: 11 }))).toBe('EXCEEDS_PENDING');
    expect(errorOf(line({ received: 8, counted: 3 }))).toBe('EXCEEDS_PENDING');
    expect(errorOf(line({ counted: -1 }))).toBe('INVALID');
    expect(errorOf(line({ counted: 1.5 }))).toBe('INVALID');
  });

  it('summarizes the pieces received now and the ones still pending', () => {
    const lines = setCounted([line({ productId: 'a' }), line({ productId: 'b', sent: 4, received: 1 })], 'a', 6);
    expect(summarize(lines)).toEqual({ receivingNow: 6, stillPending: 7, errors: 0 });
    expect(summarize(setCounted(lines, 'b', 9)).errors).toBe(1);
  });

  it('sends only the products with pieces counted', () => {
    const lines = setCounted(setCounted([line({ productId: 'a' }), line({ productId: 'b' })], 'a', 0), 'b', 2);
    expect(toSessionLines(lines)).toEqual([{ productId: 'b', quantity: 2 }]);
  });

  it('searches by code, name or brand and pages by 10', () => {
    const lines = [line({ productId: 'a', code: '6204' }), line({ productId: 'b', code: '7001', brand: 'NSK' })];
    expect(filterLines(lines, 'nsk').map((l) => l.productId)).toEqual(['b']);
    expect(filterLines(lines, '  ')).toHaveLength(2);
    const many = Array.from({ length: 23 }, (_, i) => i);
    expect(pageCountOf(many.length)).toBe(3);
    expect(pageOf(many, 3)).toEqual([20, 21, 22]);
    expect(pageOf(many, 99)).toEqual([20, 21, 22]);
  });
});

describe('differences at close', () => {
  const lines = [
    line({ productId: 'a', sent: 10, counted: 8 }),
    line({ productId: 'b', sent: 10, counted: 10, unitCost: '2.5000' }),
    line({ productId: 'c', sent: 4, counted: 4 }),
  ];

  it('lists the shortage of a line that ends short and the surplus of one received in full', () => {
    expect(differencesOf(lines, { b: 2, a: 5 })).toEqual([
      { productId: 'a', code: '6204-2RS', name: 'Rodamiento · SKF', kind: 'SHORTAGE', quantity: -2, value: '10.00' },
      { productId: 'b', code: '6204-2RS', name: 'Rodamiento · SKF', kind: 'SURPLUS', quantity: 2, value: '5.00' },
    ]);
  });

  it('has no differences when everything matched', () => {
    expect(differencesOf(lines.slice(1), {})).toEqual([]);
  });

  it('only lines received in full can carry a surplus', () => {
    expect(canHaveSurplus(lines[0])).toBe(false);
    expect(canHaveSurplus(lines[1])).toBe(true);
    expect(toSurplusLines(lines, { a: 3, b: 2, c: 0 })).toEqual([{ productId: 'b', quantity: 2 }]);
  });
});
