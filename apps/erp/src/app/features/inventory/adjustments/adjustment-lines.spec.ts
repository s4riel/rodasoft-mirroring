import type { AdjustmentProductSearchItem, AdjustmentResolvedLine } from '@rodasoft/domain';
import { AdjustmentLine, lineDelta, lineError, lineValue, newLine, recognizedAdditions, resultingStock, summarize } from './adjustment-lines';

const product: AdjustmentProductSearchItem = {
  id: 'p1',
  sku: 'SKU-1',
  manufacturerCode: 'ABC-1',
  name: 'Rodamiento',
  brand: 'SKF',
  available: 10,
  unitCost: '5.0000',
};

const line = (over: Partial<AdjustmentLine> = {}): AdjustmentLine => ({ ...newLine(product), ...over });

describe('newLine', () => {
  it('starts as an outward line with no quantity, remembering the stock it was read against', () => {
    expect(newLine(product)).toMatchObject({ productId: 'p1', kind: 'OUT', quantity: null, available: 10, unitCost: '5.0000' });
  });
});

describe('lineDelta and resultingStock', () => {
  it('computes the change of each kind against the stock read', () => {
    expect(lineDelta(line({ kind: 'IN', quantity: 4 }))).toBe(4);
    expect(lineDelta(line({ kind: 'OUT', quantity: 4 }))).toBe(-4);
    expect(lineDelta(line({ kind: 'COUNT', quantity: 7 }))).toBe(-3);
    expect(resultingStock(line({ kind: 'COUNT', quantity: 12 }))).toBe(12);
    expect(resultingStock(line({ kind: 'OUT', quantity: 4 }))).toBe(6);
  });

  it('has none while the quantity is empty', () => {
    expect(lineDelta(line())).toBeNull();
    expect(resultingStock(line())).toBeNull();
  });
});

describe('lineError', () => {
  it('asks for the quantity when it is empty', () => {
    expect(lineError(line())).toBe('Ingresa la cantidad');
  });

  it('needs at least 1 piece for an entry or an exit, but allows a count of 0', () => {
    expect(lineError(line({ kind: 'IN', quantity: 0 }))).toBe('La cantidad debe ser al menos 1');
    expect(lineError(line({ kind: 'COUNT', quantity: 0 }))).toBeNull();
  });

  it('refuses to take out more than the stock', () => {
    expect(lineError(line({ kind: 'OUT', quantity: 11 }))).toBe('Supera el stock disponible');
    expect(lineError(line({ kind: 'OUT', quantity: 10 }))).toBeNull();
  });
});

describe('summarize', () => {
  it('counts products, moved pieces, value and lines with errors', () => {
    const summary = summarize([
      line({ productId: 'a', kind: 'IN', quantity: 4 }),
      line({ productId: 'b', kind: 'OUT', quantity: 3 }),
      line({ productId: 'c' }),
    ]);
    expect(summary).toEqual({ products: 3, pieces: 7, value: '35.00', errors: 1, changesStock: true });
  });

  it('flags an adjustment where nothing changes', () => {
    expect(summarize([line({ kind: 'COUNT', quantity: 10 })]).changesStock).toBe(false);
    expect(summarize([]).changesStock).toBe(false);
  });

  it('values a line without cost as 0', () => {
    expect(summarize([line({ kind: 'IN', quantity: 2, unitCost: null })]).value).toBe('0.00');
    expect(lineValue(line({ kind: 'IN', quantity: 2, unitCost: null }))).toBeNull();
    expect(lineValue(line({ kind: 'OUT', quantity: 2 }))).toBe('10.00');
  });
});

describe('recognizedAdditions', () => {
  const resolved = (group: AdjustmentResolvedLine['group'], over: Partial<AdjustmentResolvedLine> = {}): AdjustmentResolvedLine => ({
    line: 1,
    code: 'A-1',
    quantity: 4,
    kind: 'COUNT',
    group,
    product: { id: 'p1', sku: 's', manufacturerCode: 'A-1', name: 'Rodamiento', brand: 'SKF' },
    available: 7,
    unitCost: '5.0000',
    ...over,
  });

  it('keeps the recognized lines with their kind and quantity, and the stock and cost they were read with', () => {
    expect(recognizedAdditions([resolved('RECOGNIZED')])).toEqual([
      { kind: 'COUNT', quantity: 4, product: { id: 'p1', sku: 's', manufacturerCode: 'A-1', name: 'Rodamiento', brand: 'SKF', available: 7, unitCost: '5.0000' } },
    ]);
  });

  it('leaves out what is not found, inactive or without stock', () => {
    const lines = [resolved('NOT_FOUND', { product: null }), resolved('INACTIVE'), resolved('INSUFFICIENT_STOCK')];
    expect(recognizedAdditions(lines)).toEqual([]);
  });

  it('builds a line with the kind and quantity of the list', () => {
    const [addition] = recognizedAdditions([resolved('RECOGNIZED')]);
    expect(newLine(addition.product, addition.kind, addition.quantity)).toMatchObject({ kind: 'COUNT', quantity: 4, available: 7 });
  });
});
