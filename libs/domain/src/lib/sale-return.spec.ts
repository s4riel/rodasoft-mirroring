import { Decimal } from './money';
import {
  isWithinReturnWindow,
  needsReturnApproval,
  normalizeReturnLines,
  returnableQuantity,
  returnTimeline,
  returnTotals,
  splitReturnRefund,
  validateReturnDecision,
  validateReturnHeader,
  validateReturnLines,
} from './sale-return';

const items = [
  { saleItemId: 'a', quantity: 3, returnedQuantity: 1 },
  { saleItemId: 'b', quantity: 2, returnedQuantity: 0 },
];

describe('splitReturnRefund (HU-VEN-34)', () => {
  const d = (value: string) => Decimal.of(value);

  it('pays everything out when the sale collected its whole total', () => {
    const split = splitReturnRefund(d('100.00'), d('500.00'), d('0.00'));
    expect([split.paidOut.toString(), split.onCredit.toString()]).toEqual(['100.00', '0.00']);
  });

  it('pays nothing out on a sale that collected nothing: all of it reduces the balance', () => {
    const split = splitReturnRefund(d('245.00'), d('0.00'), d('0.00'));
    expect([split.paidOut.toString(), split.onCredit.toString()]).toEqual(['0.00', '245.00']);
  });

  it('pays out only what is left of the collected money, earlier returns first', () => {
    const split = splitReturnRefund(d('100.00'), d('150.00'), d('100.00'));
    expect([split.paidOut.toString(), split.onCredit.toString()]).toEqual(['50.00', '50.00']);
  });

  it('never pays out a negative amount once the earlier returns passed the collected money', () => {
    const split = splitReturnRefund(d('100.00'), d('150.00'), d('400.00'));
    expect([split.paidOut.toString(), split.onCredit.toString()]).toEqual(['0.00', '100.00']);
  });
});

describe('returnableQuantity', () => {
  it('is what was sold less what came back, never negative', () => {
    expect(returnableQuantity(3, 1)).toBe(2);
    expect(returnableQuantity(3, 5)).toBe(0);
  });
});

describe('validateReturnLines', () => {
  it('refuses an empty return, also one of zeros', () => {
    expect(validateReturnLines(items, [])).toEqual([{ code: 'RETURN_EMPTY' }]);
    expect(validateReturnLines(items, [{ saleItemId: 'a', quantity: 0, condition: 'RESTOCK' }])).toEqual([{ code: 'RETURN_EMPTY' }]);
  });
  it('accepts up to the returnable quantity', () => {
    expect(
      validateReturnLines(items, [
        { saleItemId: 'a', quantity: 2, condition: 'RESTOCK' },
        { saleItemId: 'b', quantity: 1, condition: 'SCRAP' },
      ]),
    ).toEqual([]);
  });
  it('adds the stock and scrap lines of one item together before comparing', () => {
    const issues = validateReturnLines(items, [
      { saleItemId: 'a', quantity: 1, condition: 'RESTOCK' },
      { saleItemId: 'a', quantity: 2, condition: 'SCRAP' },
    ]);
    expect(issues).toEqual([{ code: 'RETURN_EXCEEDS_SOLD', saleItemId: 'a', requested: 3, returnable: 2 }]);
  });
  it('reports an unknown line, a bad quantity and a bad condition', () => {
    expect(validateReturnLines(items, [{ saleItemId: 'x', quantity: 1, condition: 'RESTOCK' }])[0].code).toBe('SALE_ITEM_NOT_FOUND');
    expect(validateReturnLines(items, [{ saleItemId: 'a', quantity: 1.5, condition: 'RESTOCK' }])[0].code).toBe('INVALID_QUANTITY');
    expect(validateReturnLines(items, [{ saleItemId: 'a', quantity: 1, condition: 'LOST' as never }])[0].code).toBe('INVALID_CONDITION');
  });
});

describe('normalizeReturnLines', () => {
  it('merges the same line and condition', () => {
    expect(
      normalizeReturnLines([
        { saleItemId: 'a', quantity: 1, condition: 'RESTOCK' },
        { saleItemId: 'a', quantity: 1, condition: 'RESTOCK' },
      ]),
    ).toEqual([{ saleItemId: 'a', quantity: 2, condition: 'RESTOCK' }]);
  });
});

describe('validateReturnHeader', () => {
  it('needs a reason, a refund method and, for a transfer, the reference', () => {
    expect(validateReturnHeader({ reason: 'x', refundMethod: 'y' })).toEqual(['REASON_INVALID', 'REFUND_METHOD_INVALID']);
    expect(validateReturnHeader({ reason: 'OTHER', refundMethod: 'TRANSFER', refundReference: '  ' })).toEqual(['TRANSFER_REFERENCE_REQUIRED']);
    expect(validateReturnHeader({ reason: 'OTHER', refundMethod: 'TRANSFER', refundReference: 'TR-1' })).toEqual([]);
    expect(validateReturnHeader({ reason: 'OTHER', refundMethod: 'CASH', comment: 'x'.repeat(501) })).toEqual(['COMMENT_TOO_LONG']);
  });
});

describe('validateReturnDecision', () => {
  it('needs a reply only to reject', () => {
    expect(validateReturnDecision('REJECT', ' ')).toEqual(['COMMENT_REQUIRED']);
    expect(validateReturnDecision('APPROVE', undefined)).toEqual([]);
    expect(validateReturnDecision('APPROVE', 'x'.repeat(501))).toEqual(['COMMENT_TOO_LONG']);
  });
});

describe('isWithinReturnWindow', () => {
  it('has no deadline without days', () => {
    expect(isWithinReturnWindow(new Date('2026-01-01T12:00:00Z'), new Date('2027-01-01T12:00:00Z'), null)).toBe(true);
  });
  it('closes after the last allowed day', () => {
    const soldAt = new Date('2026-11-02T15:00:00Z');
    expect(isWithinReturnWindow(soldAt, new Date('2026-11-09T15:00:00Z'), 7)).toBe(true);
    expect(isWithinReturnWindow(soldAt, new Date('2026-11-10T04:00:00Z'), 7)).toBe(false);
  });
});

describe('needsReturnApproval', () => {
  it('asks only above the limit', () => {
    expect(needsReturnApproval('245.00', null)).toBe(false);
    expect(needsReturnApproval('245.00', '100.00')).toBe(true);
    expect(needsReturnApproval('100.00', '100.00')).toBe(false);
  });
});

describe('returnTotals', () => {
  const sale = { subtotal: Decimal.of('300.00'), total: Decimal.of('270.00') }; // 10 % customer discount
  it('shares the discount in proportion to the line', () => {
    const r = returnTotals({ sale, previousRefunded: Decimal.zero(), lines: [{ unitPrice: '100.00', quantity: 1 }], completesSale: false });
    expect(r.total.toString()).toBe('90.00');
  });
  it('makes all the refunds of a sale add up to the sale total to the cent', () => {
    const odd = { subtotal: Decimal.of('100.00'), total: Decimal.of('99.99') };
    const first = returnTotals({ sale: odd, previousRefunded: Decimal.zero(), lines: [{ unitPrice: '33.33', quantity: 1 }], completesSale: false });
    const second = returnTotals({ sale: odd, previousRefunded: first.total, lines: [{ unitPrice: '33.33', quantity: 1 }], completesSale: false });
    const last = returnTotals({
      sale: odd,
      previousRefunded: first.total.add(second.total),
      lines: [{ unitPrice: '33.34', quantity: 1 }],
      completesSale: true,
    });
    expect(first.total.add(second.total).add(last.total).toString()).toBe('99.99');
  });
  it('puts the remainder of a completing return on the last line', () => {
    const r = returnTotals({
      sale: { subtotal: Decimal.of('10.00'), total: Decimal.of('10.00') },
      previousRefunded: Decimal.of('3.33'),
      lines: [
        { unitPrice: '3.33', quantity: 1 },
        { unitPrice: '3.34', quantity: 1 },
      ],
      completesSale: true,
    });
    expect(r.total.toString()).toBe('6.67');
    expect(r.lines.map(String)).toEqual(['3.33', '3.34']);
  });
});

describe('returnTimeline', () => {
  const base = { createdAt: '2026-11-09T10:00:00.000Z', approvedAt: '2026-11-09T10:00:00.000Z' };
  it('is waiting for approval', () => {
    const steps = returnTimeline({ ...base, approvedAt: null, status: 'PENDING_APPROVAL', creditNoteStatus: null });
    expect(steps.map((s) => s.state)).toEqual(['done', 'current', 'pending', 'pending']);
  });
  it('has a pending credit note after approval', () => {
    const steps = returnTimeline({ ...base, status: 'APPROVED', creditNoteStatus: 'PENDING' });
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'current', 'done']);
  });
  it('is done once the note is issued, and stops at a rejection', () => {
    expect(returnTimeline({ ...base, status: 'APPROVED', creditNoteStatus: 'VALID' }).every((s) => s.state === 'done')).toBe(true);
    expect(returnTimeline({ ...base, approvedAt: null, status: 'REJECTED', creditNoteStatus: null }).map((s) => s.state)).toEqual([
      'done',
      'pending',
      'pending',
      'pending',
    ]);
  });
});
