import { Decimal } from './money';
import {
  completesOrder,
  dispatchableQuantity,
  dispatchTotals,
  isInvoicedStatus,
  nextOrderEvent,
  normalizeDispatchRequest,
  orderTimeline,
  pendingQuantity,
  validateDispatch,
  type DispatchableItem,
} from './sales-order-dispatch';
import type { RoundingMode } from './sales-pricing';

const d = (v: string) => Decimal.of(v);
const item = (orderItemId: string, quantity: number, dispatchedQuantity = 0, reservedQuantity = quantity): DispatchableItem => ({
  orderItemId,
  quantity,
  reservedQuantity,
  dispatchedQuantity,
});

describe('quantities', () => {
  it('what can leave is what is reserved and not dispatched', () => {
    expect(dispatchableQuantity({ reservedQuantity: 12, dispatchedQuantity: 5 })).toBe(7);
    expect(dispatchableQuantity({ reservedQuantity: 3, dispatchedQuantity: 3 })).toBe(0);
    expect(dispatchableQuantity({ reservedQuantity: 0, dispatchedQuantity: 3 })).toBe(0);
  });

  it('the balance is what was ordered and has not left', () => {
    expect(pendingQuantity({ quantity: 12, dispatchedQuantity: 5 })).toBe(7);
    expect(pendingQuantity({ quantity: 4, dispatchedQuantity: 4 })).toBe(0);
  });
});

describe('isInvoicedStatus', () => {
  it('counts an invoice waiting for the SIAT, in process, issued or observed', () => {
    for (const status of ['PENDING', 'SENDING', 'VALID']) expect(isInvoicedStatus(status)).toBe(true);
  });

  it('does not count a cancelled, rejected or being-cancelled invoice, or a missing one', () => {
    for (const status of ['CANCELLED', 'REJECTED', 'CANCELLATION_PENDING', null, undefined]) expect(isInvoicedStatus(status)).toBe(false);
  });
});

describe('normalizeDispatchRequest', () => {
  it('adds repeated lines and drops zeros', () => {
    expect(
      normalizeDispatchRequest([
        { orderItemId: 'a', quantity: 2 },
        { orderItemId: 'b', quantity: 0 },
        { orderItemId: 'a', quantity: 3 },
      ]),
    ).toEqual([{ orderItemId: 'a', quantity: 5 }]);
  });
});

describe('validateDispatch', () => {
  const items = [item('a', 12), item('b', 6), item('c', 4)];

  it('accepts part of what is pending', () => {
    expect(validateDispatch(items, [{ orderItemId: 'a', quantity: 12 }, { orderItemId: 'b', quantity: 3 }], true)).toEqual([]);
  });

  it('refuses an empty dispatch, also when every quantity is zero', () => {
    expect(validateDispatch(items, [], true)).toEqual([{ code: 'DISPATCH_EMPTY' }]);
    expect(validateDispatch(items, [{ orderItemId: 'a', quantity: 0 }], true)).toEqual([{ code: 'DISPATCH_EMPTY' }]);
  });

  it('refuses a line of another order', () => {
    expect(validateDispatch(items, [{ orderItemId: 'x', quantity: 1 }], true)).toEqual([{ code: 'ORDER_ITEM_NOT_FOUND', orderItemId: 'x' }]);
  });

  it('refuses more than what is reserved and not dispatched, naming the line', () => {
    const after = [item('a', 12, 10), item('b', 6)];
    expect(validateDispatch(after, [{ orderItemId: 'a', quantity: 3 }], true)).toEqual([
      { code: 'DISPATCH_EXCEEDS_RESERVED', orderItemId: 'a', requested: 3, dispatchable: 2 },
    ]);
  });

  it('refuses fractions and negatives', () => {
    expect(validateDispatch(items, [{ orderItemId: 'a', quantity: 1.5 }], true)[0].code).toBe('INVALID_QUANTITY');
    expect(validateDispatch(items, [{ orderItemId: 'a', quantity: -1 }], true)[0].code).toBe('INVALID_QUANTITY');
  });

  it('without partial dispatch it must give everything that is pending', () => {
    expect(validateDispatch(items, [{ orderItemId: 'a', quantity: 12 }], false)).toEqual([{ code: 'PARTIAL_DISPATCH_NOT_ALLOWED' }]);
    const all = items.map((i) => ({ orderItemId: i.orderItemId, quantity: i.quantity }));
    expect(validateDispatch(items, all, false)).toEqual([]);
  });

  it('without partial dispatch the rest of an earlier dispatch can go alone', () => {
    const after = [item('a', 12, 12), item('b', 6, 3)];
    expect(validateDispatch(after, [{ orderItemId: 'b', quantity: 3 }], false)).toEqual([]);
  });
});

describe('completesOrder / nextOrderEvent', () => {
  const items = [item('a', 12), item('b', 6)];

  it('is dispatchPartial while something stays pending', () => {
    expect(completesOrder(items, [{ orderItemId: 'a', quantity: 12 }])).toBe(false);
    expect(nextOrderEvent(items, [{ orderItemId: 'a', quantity: 12 }, { orderItemId: 'b', quantity: 5 }])).toBe('dispatchPartial');
  });

  it('is dispatchAll when nothing is left, also over several dispatches', () => {
    expect(nextOrderEvent(items, [{ orderItemId: 'a', quantity: 12 }, { orderItemId: 'b', quantity: 6 }])).toBe('dispatchAll');
    const after = [item('a', 12, 12), item('b', 6, 4)];
    expect(nextOrderEvent(after, [{ orderItemId: 'b', quantity: 2 }])).toBe('dispatchAll');
  });
});

describe('dispatchTotals', () => {
  type Discount = { type: 'NONE' | 'PERCENT' | 'AMOUNT'; value: string };
  const lines = [
    { id: 'a', unitPrice: '33.33', quantity: 7 },
    { id: 'b', unitPrice: '120.10', quantity: 3 },
    { id: 'c', unitPrice: '9.99', quantity: 11 },
  ];

  /** The order totals as the quote fixes them: customer discount, then rounding. */
  function orderOf(discount: Discount, mode: RoundingMode) {
    const subtotal = lines.reduce((acc, l) => acc.add(d(l.unitPrice).mul(l.quantity)), d('0'));
    const discountAmount =
      discount.type === 'PERCENT' ? subtotal.percent(discount.value) : discount.type === 'AMOUNT' ? d(discount.value) : d('0');
    const afterDiscount = subtotal.sub(discountAmount);
    const step = { NONE: 1n, INTEGER: 100n, HALF_BOLIVIANO: 50n }[mode];
    const units = afterDiscount.units;
    const roundedUnits = ((units + step / 2n) / step) * step;
    const total = Decimal.fromUnits(roundedUnits, 2);
    return { subtotal, discountAmount, roundingAmount: total.sub(afterDiscount), total };
  }

  /** Dispatches the lines in the given groups, one dispatch per group, and returns each dispatch's amounts. */
  function run(groups: string[][], discount: Discount, mode: RoundingMode) {
    const order = orderOf(discount, mode);
    const previous: ReturnType<typeof dispatchTotals>[] = [];
    groups.forEach((group, index) => {
      previous.push(
        dispatchTotals({
          order,
          previous: [...previous],
          lines: lines.filter((l) => group.includes(l.id)),
          completesOrder: index === groups.length - 1,
          roundingMode: mode,
        }),
      );
    });
    return { order, parts: previous };
  }

  const discounts: Discount[] = [
    { type: 'NONE', value: '0' },
    { type: 'PERCENT', value: '7.5' },
    { type: 'AMOUNT', value: '41.17' },
  ];
  const modes: RoundingMode[] = ['NONE', 'INTEGER', 'HALF_BOLIVIANO'];
  const splits = [[['a', 'b', 'c']], [['a'], ['b', 'c']], [['a'], ['b'], ['c']], [['c'], ['a'], ['b']]];

  for (const discount of discounts) {
    for (const mode of modes) {
      for (const groups of splits) {
        it(`the sales of ${groups.length} dispatch(es) add up to the order (${discount.type}, ${mode})`, () => {
          const { order, parts } = run(groups, discount, mode);
          const sum = (pick: (p: (typeof parts)[number]) => Decimal) => parts.reduce((acc, p) => acc.add(pick(p)), d('0'));
          expect(sum((p) => p.subtotal).toString()).toBe(order.subtotal.toString());
          expect(sum((p) => p.discountAmount).toString()).toBe(order.discountAmount.toString());
          expect(sum((p) => p.roundingAmount).toString()).toBe(order.roundingAmount.toString());
          expect(sum((p) => p.total).toString()).toBe(order.total.toString());
          // every part is a real amount: nothing below zero
          for (const p of parts) expect(p.total.isNegative()).toBe(false);
        });
      }
    }
  }

  it('a dispatch that carries part of the order takes the same share of the discount', () => {
    const order = { subtotal: d('200.00'), discountAmount: d('20.00'), roundingAmount: d('0.00'), total: d('180.00') };
    const part = dispatchTotals({
      order,
      previous: [],
      lines: [{ unitPrice: '50.00', quantity: 2 }],
      completesOrder: false,
      roundingMode: 'NONE',
    });
    expect(part.subtotal.toString()).toBe('100.00');
    expect(part.discountAmount.toString()).toBe('10.00');
    expect(part.total.toString()).toBe('90.00');
  });

  it('rounds the total of a part with the rounding mode', () => {
    const order = { subtotal: d('100.00'), discountAmount: d('0.00'), roundingAmount: d('0.00'), total: d('100.00') };
    const part = dispatchTotals({ order, previous: [], lines: [{ unitPrice: '10.30', quantity: 1 }], completesOrder: false, roundingMode: 'INTEGER' });
    expect(part.total.toString()).toBe('10.00');
    expect(part.roundingAmount.toString()).toBe('-0.30');
  });

  it('an order without subtotal shares no discount', () => {
    const order = { subtotal: d('0.00'), discountAmount: d('0.00'), roundingAmount: d('0.00'), total: d('0.00') };
    const part = dispatchTotals({ order, previous: [], lines: [{ unitPrice: '0.00', quantity: 1 }], completesOrder: false, roundingMode: 'NONE' });
    expect(part.total.toString()).toBe('0.00');
  });
});

describe('orderTimeline', () => {
  const base = { createdAt: '2026-11-07T10:00:00.000Z', dispatchedAt: null, completedAt: null };

  it('a new order is created and reserved, waiting for its dispatch', () => {
    const steps = orderTimeline({ ...base, status: 'OPEN' });
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'current', 'pending', 'pending']);
  });

  it('a partially dispatched order keeps the dispatch step current', () => {
    const steps = orderTimeline({ ...base, status: 'PARTIALLY_DISPATCHED', dispatchedAt: '2026-11-08T10:00:00.000Z' });
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'current', 'pending', 'pending']);
    expect(steps[2].at).toBe('2026-11-08T10:00:00.000Z');
  });

  it('a dispatched order is complete', () => {
    const steps = orderTimeline({ ...base, status: 'DISPATCHED', dispatchedAt: '2026-11-08T10:00:00.000Z', completedAt: '2026-11-09T10:00:00.000Z' });
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done', 'done']);
    expect(steps[4].at).toBe('2026-11-09T10:00:00.000Z');
  });

  it('a cancelled order goes no further than its reservation', () => {
    expect(orderTimeline({ ...base, status: 'CANCELLED' }).map((s) => s.state)).toEqual(['done', 'done', 'pending', 'pending', 'pending']);
  });
});
