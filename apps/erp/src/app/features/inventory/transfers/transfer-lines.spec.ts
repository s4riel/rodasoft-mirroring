import type { TransferResolvedLine } from '@rodasoft/domain';
import {
  addProduct,
  type AddableProduct,
  type EditorLine,
  errorOf,
  pageCountOf,
  pageOf,
  recognizedLines,
  removeLine,
  setQuantity,
  summarize,
  visibleLines,
} from './transfer-lines';

const product = (over: Partial<AddableProduct> = {}): AddableProduct => ({
  id: 'p1',
  sku: 'RL-1',
  manufacturerCode: '6204-2RS',
  name: 'Rodamiento rígido',
  brand: 'SKF',
  available: 10,
  unitCost: '5.0000',
  ...over,
});

const line = (over: Partial<EditorLine> = {}): EditorLine => ({ ...addProduct([], product())[0], savedQuantity: 1, ...over });

describe('addProduct', () => {
  it('puts a new product on top with quantity 1', () => {
    const lines = addProduct(addProduct([], product({ id: 'a' })), product({ id: 'b' }));
    expect(lines.map((l) => l.productId)).toEqual(['b', 'a']);
    expect(lines[0]).toMatchObject({ quantity: 1, savedQuantity: null });
  });

  it('adds to the quantity of a product that is already there instead of repeating it', () => {
    const once = addProduct([], product());
    const twice = addProduct(once, product({ available: 8 }), 3);
    expect(twice).toHaveLength(1);
    expect(twice[0]).toMatchObject({ quantity: 4, available: 8 });
  });
});

describe('errorOf', () => {
  it('flags a quantity that is not a whole number above zero, and one above the stock', () => {
    expect(errorOf(line({ quantity: 0 }))).toBe('INVALID_QUANTITY');
    expect(errorOf(line({ quantity: 1.5 }))).toBe('INVALID_QUANTITY');
    expect(errorOf(line({ quantity: 11 }))).toBe('INSUFFICIENT_STOCK');
    expect(errorOf(line({ quantity: 10 }))).toBeNull();
  });
});

describe('visibleLines', () => {
  const lines = [
    line({ productId: 'a', manufacturerCode: '6204', name: 'Rodamiento', quantity: 1, savedQuantity: 1 }),
    line({ productId: 'b', manufacturerCode: '6205', name: 'Cadena', brand: 'Ráfaga', quantity: 99, savedQuantity: 5 }),
    line({ productId: 'c', manufacturerCode: '6206', name: 'Sello', quantity: 2, savedQuantity: null }),
  ];

  it('filters by error and by "sin cambios"', () => {
    expect(visibleLines(lines, 'error', '').map((l) => l.productId)).toEqual(['b']);
    expect(visibleLines(lines, 'unchanged', '').map((l) => l.productId)).toEqual(['a']);
    expect(visibleLines(lines, 'all', '')).toHaveLength(3);
  });

  it('searches code, name and brand ignoring case and accents', () => {
    expect(visibleLines(lines, 'all', 'rafaga').map((l) => l.productId)).toEqual(['b']);
    expect(visibleLines(lines, 'all', '6204').map((l) => l.productId)).toEqual(['a']);
    expect(visibleLines(lines, 'error', 'sello')).toEqual([]);
  });
});

describe('pagination', () => {
  const many = Array.from({ length: 25 }, (_, i) => i);

  it('pages by 10 and counts at least one page', () => {
    expect(pageOf(many, 1)).toHaveLength(10);
    expect(pageOf(many, 3)).toEqual([20, 21, 22, 23, 24]);
    expect(pageCountOf(25)).toBe(3);
    expect(pageCountOf(0)).toBe(1);
  });

  it('keeps edits across pages because the edits live in the full list', () => {
    const lines = Array.from({ length: 12 }, (_, i) => line({ productId: `p${i}`, quantity: 1 }));
    const edited = setQuantity(lines, 'p11', 7);
    expect(pageOf(edited, 2).find((l) => l.productId === 'p11')?.quantity).toBe(7);
    expect(pageOf(edited, 1)).toHaveLength(10);
  });
});

describe('summarize', () => {
  it('totals products, pieces, errors and the value with exact decimals', () => {
    const summary = summarize([
      line({ productId: 'a', quantity: 3, unitCost: '10.3333' }),
      line({ productId: 'b', quantity: 99, unitCost: '1.0000' }),
      line({ productId: 'c', quantity: 0, unitCost: '9.0000' }),
    ]);
    expect(summary).toEqual({ products: 3, pieces: 102, value: '130.00', errors: 2 });
  });

  it('has no value when no line carries a cost (the user cannot see costs)', () => {
    expect(summarize([line({ unitCost: null })]).value).toBeNull();
  });
});

describe('removeLine and recognizedLines', () => {
  it('removes a line by product', () => {
    expect(removeLine([line({ productId: 'a' }), line({ productId: 'b' })], 'a').map((l) => l.productId)).toEqual(['b']);
  });

  it('keeps only the recognized lines of a resolved list', () => {
    const resolved: TransferResolvedLine[] = [
      { line: 1, code: 'A', quantity: 2, group: 'RECOGNIZED', product: { id: 'a', sku: 's', manufacturerCode: 'A', name: 'n', brand: 'b' }, available: 5, unitCost: null },
      { line: 2, code: 'B', quantity: 2, group: 'INSUFFICIENT_STOCK', product: { id: 'b', sku: 's', manufacturerCode: 'B', name: 'n', brand: 'b' }, available: 1, unitCost: null },
      { line: 3, code: 'C', quantity: 2, group: 'NOT_FOUND', product: null, available: null, unitCost: null },
    ];
    const kept = recognizedLines(resolved);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ quantity: 2, product: { id: 'a', available: 5 } });
  });
});
