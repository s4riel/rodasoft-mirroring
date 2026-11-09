import {
  CASH_DENOMINATIONS,
  CASH_DETAIL_MAX,
  CASH_MOVEMENT_CONCEPTS,
  closingDifferences,
  countedTotal,
  expenseExceedsCash,
  needsExpenseApproval,
  normalizeCashCounts,
  normalizeDenomination,
  parseCashAmount,
  paymentMethodTotals,
  planClosing,
  shiftCashSummary,
  validateCashMovement,
  type CloseCashShiftInput,
} from './cash-register';
import { Decimal } from './money';

describe('validateCashMovement', () => {
  const valid = { type: 'EXPENSE', amount: '50.00', concept: 'FREIGHT', detail: 'Flete a Oruro' };

  it('accepts an expense and an income with a known concept', () => {
    const expense = validateCashMovement(valid);
    expect(expense.ok && expense.value.amount.toString()).toBe('50.00');
    const income = validateCashMovement({ type: 'INCOME', amount: '10,5', concept: 'BALANCE_COLLECTION' });
    expect(income.ok && income.value.detail).toBeNull();
  });

  it('keeps a separate concept list per type', () => {
    expect(CASH_MOVEMENT_CONCEPTS.INCOME).not.toContain('FREIGHT');
    expect(validateCashMovement({ ...valid, type: 'INCOME' })).toEqual({ ok: false, errors: ['INVALID_CASH_CONCEPT'] });
    expect(validateCashMovement({ ...valid, concept: 'BALANCE_COLLECTION' })).toEqual({ ok: false, errors: ['INVALID_CASH_CONCEPT'] });
  });

  it('refuses a type that is not manual (sales and refunds are written by the system)', () => {
    expect(validateCashMovement({ ...valid, type: 'SALE_PAYMENT' })).toEqual({ ok: false, errors: ['INVALID_CASH_TYPE'] });
    expect(validateCashMovement({ ...valid, type: 'REFUND' })).toEqual({ ok: false, errors: ['INVALID_CASH_TYPE'] });
  });

  it.each(['0', '0.00', '-5', '', 'abc', '10.123', '10000000000'])('refuses the amount %j', (amount) => {
    expect(validateCashMovement({ ...valid, amount })).toEqual({ ok: false, errors: ['INVALID_CASH_AMOUNT'] });
  });

  it('needs a detail for the concept OTHER and limits its length', () => {
    expect(validateCashMovement({ ...valid, concept: 'OTHER', detail: '  ' })).toEqual({ ok: false, errors: ['CASH_DETAIL_REQUIRED'] });
    expect(validateCashMovement({ ...valid, concept: 'OTHER', detail: undefined })).toEqual({ ok: false, errors: ['CASH_DETAIL_REQUIRED'] });
    expect(validateCashMovement({ ...valid, concept: 'OTHER', detail: 'x'.repeat(CASH_DETAIL_MAX) }).ok).toBe(true);
    expect(validateCashMovement({ ...valid, detail: 'x'.repeat(CASH_DETAIL_MAX + 1) })).toEqual({ ok: false, errors: ['CASH_DETAIL_TOO_LONG'] });
  });

  it('reports every field problem at once', () => {
    expect(validateCashMovement({ type: 'EXPENSE', amount: '0', concept: 'nope' })).toEqual({
      ok: false,
      errors: ['INVALID_CASH_AMOUNT', 'INVALID_CASH_CONCEPT'],
    });
  });

  it('parses only strictly positive amounts', () => {
    expect(parseCashAmount('0.01')?.toString()).toBe('0.01');
    expect(parseCashAmount('0')).toBeNull();
    expect(parseCashAmount(null)).toBeNull();
  });
});

describe('needsExpenseApproval', () => {
  it('never asks without a limit', () => {
    expect(needsExpenseApproval(Decimal.of('999999'), null)).toBe(false);
  });

  it('asks only above the limit', () => {
    expect(needsExpenseApproval(Decimal.of('100.01'), '100.00')).toBe(true);
    expect(needsExpenseApproval(Decimal.of('100.00'), '100.00')).toBe(false);
    expect(needsExpenseApproval(Decimal.of('99.99'), '100.00')).toBe(false);
  });
});

describe('shiftCashSummary', () => {
  const movement = (type: 'SALE_PAYMENT' | 'INCOME' | 'EXPENSE' | 'REFUND', amount: string, status: 'PENDING' | 'POSTED' | 'REJECTED' | 'WITHDRAWN' = 'POSTED') => ({
    type,
    amount,
    status,
  });

  it('is the opening float when nothing happened', () => {
    expect(shiftCashSummary({ openingFloat: '500.00', movements: [] }).expected).toBe('500.00');
  });

  it('adds sales and income and takes expenses and refunds', () => {
    const summary = shiftCashSummary({
      openingFloat: '500.00',
      movements: [movement('SALE_PAYMENT', '120.50'), movement('SALE_PAYMENT', '79.50'), movement('INCOME', '30.00'), movement('EXPENSE', '45.25'), movement('REFUND', '10.00')],
    });
    expect(summary).toEqual({ openingFloat: '500.00', cashSales: '200.00', income: '30.00', expenses: '45.25', refunds: '10.00', expected: '674.75' });
  });

  it('ignores an expense that is not posted', () => {
    const summary = shiftCashSummary({
      openingFloat: '100.00',
      movements: [movement('EXPENSE', '40.00', 'PENDING'), movement('EXPENSE', '30.00', 'REJECTED'), movement('EXPENSE', '20.00', 'WITHDRAWN'), movement('EXPENSE', '5.00')],
    });
    expect(summary.expenses).toBe('5.00');
    expect(summary.expected).toBe('95.00');
  });

  it('can go below zero when refunds exceed the cash, and says so with a sign', () => {
    expect(shiftCashSummary({ openingFloat: '0.00', movements: [movement('REFUND', '12.00')] }).expected).toBe('-12.00');
  });

  it('refuses an expense that takes more than the register holds', () => {
    expect(expenseExceedsCash('100.00', Decimal.of('100.01'))).toBe(true);
    expect(expenseExceedsCash('100.00', Decimal.of('100.00'))).toBe(false);
  });
});

describe('paymentMethodTotals', () => {
  it('lists the four methods with zero and hides credit when it has no amount', () => {
    expect(paymentMethodTotals([])).toEqual([
      { method: 'CASH', amount: '0.00', count: 0 },
      { method: 'QR', amount: '0.00', count: 0 },
      { method: 'CARD', amount: '0.00', count: 0 },
      { method: 'TRANSFER', amount: '0.00', count: 0 },
    ]);
  });

  it('adds the amounts and counts the payments of each method', () => {
    const totals = paymentMethodTotals([
      { method: 'CASH', amount: '100.00' },
      { method: 'CASH', amount: '50.50' },
      { method: 'QR', amount: '70.00' },
      { method: 'CREDIT', amount: '300.00' },
    ]);
    expect(totals.find((t) => t.method === 'CASH')).toEqual({ method: 'CASH', amount: '150.50', count: 2 });
    expect(totals.find((t) => t.method === 'QR')).toEqual({ method: 'QR', amount: '70.00', count: 1 });
    expect(totals.find((t) => t.method === 'CREDIT')).toEqual({ method: 'CREDIT', amount: '300.00', count: 1 });
  });
});

describe('denominations and the count', () => {
  it('lists bills and coins from the largest', () => {
    expect(CASH_DENOMINATIONS).toEqual(['200.00', '100.00', '50.00', '20.00', '10.00', '5.00', '2.00', '1.00', '0.50']);
  });

  it('adds denomination × quantity', () => {
    expect(
      countedTotal([
        { denomination: '200.00', quantity: 1 },
        { denomination: '50', quantity: 3 },
        { denomination: '0.50', quantity: 5 },
        { denomination: '1.00', quantity: 0 },
      ]).toString(),
    ).toBe('352.50');
    expect(countedTotal([]).toString()).toBe('0.00');
  });

  it('accepts a denomination written in any form', () => {
    expect(normalizeDenomination('50')).toBe('50.00');
    expect(normalizeDenomination('0,5')).toBe('0.50');
    expect(normalizeDenomination(10)).toBe('10.00');
    expect(normalizeDenomination('0.20')).toBeNull();
    expect(normalizeDenomination('abc')).toBeNull();
    expect(normalizeDenomination(null)).toBeNull();
  });

  it('keeps only the rows with pieces, largest first', () => {
    const result = normalizeCashCounts([
      { denomination: '1', quantity: 2 },
      { denomination: '100', quantity: 1 },
      { denomination: '20', quantity: 0 },
    ]);
    expect(result).toEqual({
      ok: true,
      counts: [
        { denomination: '100.00', quantity: 1 },
        { denomination: '1.00', quantity: 2 },
      ],
    });
  });

  it('refuses an unknown or repeated denomination', () => {
    expect(normalizeCashCounts([{ denomination: '3', quantity: 1 }])).toEqual({ ok: false, error: 'INVALID_DENOMINATION' });
    expect(
      normalizeCashCounts([
        { denomination: '50', quantity: 1 },
        { denomination: '50.00', quantity: 2 },
      ]),
    ).toEqual({ ok: false, error: 'INVALID_DENOMINATION' });
  });

  it.each([-1, 1.5, Number.NaN, 100_001])('refuses the quantity %s', (quantity) => {
    expect(normalizeCashCounts([{ denomination: '50', quantity }])).toEqual({ ok: false, error: 'INVALID_COUNT' });
  });
});

describe('closingDifferences', () => {
  const system = { expectedCash: '600.00', methods: { QR: '100.00', CARD: '200.00', TRANSFER: '0.00' } };
  const declared = { cash: Decimal.of('600.00'), QR: Decimal.of('100.00'), CARD: Decimal.of('200.00'), TRANSFER: Decimal.of('0.00') };

  it('is clean when everything matches', () => {
    const result = closingDifferences(system, declared, '0.00');
    expect(result.needsReview).toBe(false);
    expect(result.differences.map((d) => d.difference)).toEqual(['0.00', '0.00', '0.00', '0.00']);
    expect(result.differences.map((d) => d.method)).toEqual(['CASH', 'QR', 'CARD', 'TRANSFER']);
  });

  it('needs review for a shortage or a surplus in cash, with the sign', () => {
    const short = closingDifferences(system, { ...declared, cash: Decimal.of('580.00') }, '0.00');
    expect(short.needsReview).toBe(true);
    expect(short.differences[0].difference).toBe('-20.00');
    expect(closingDifferences(system, { ...declared, cash: Decimal.of('600.01') }, '0.00').needsReview).toBe(true);
  });

  it('needs review for a difference in another method', () => {
    const result = closingDifferences(system, { ...declared, CARD: Decimal.of('150.00') }, '0.00');
    expect(result.needsReview).toBe(true);
    expect(result.differences.find((d) => d.method === 'CARD')?.difference).toBe('-50.00');
  });

  it('lets a difference within the tolerance pass, either way', () => {
    expect(closingDifferences(system, { ...declared, cash: Decimal.of('598.00') }, '2.00').needsReview).toBe(false);
    expect(closingDifferences(system, { ...declared, cash: Decimal.of('602.00') }, '2.00').needsReview).toBe(false);
    expect(closingDifferences(system, { ...declared, cash: Decimal.of('597.99') }, '2.00').needsReview).toBe(true);
  });
});

describe('planClosing', () => {
  const system = { expectedCash: '600.00', methods: { QR: '100.00', CARD: '0.00', TRANSFER: '0.00' } };
  const input = (over: Partial<CloseCashShiftInput> = {}): CloseCashShiftInput => ({
    counts: [
      { denomination: '200', quantity: 3 },
    ],
    declared: { QR: '100.00', CARD: '0', TRANSFER: '0' },
    closingFloat: '500.00',
    ...over,
  });

  it('plans a clean closing without a comment', () => {
    const result = planClosing(input(), system, '0.00');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan).toMatchObject({ expected: '600.00', counted: '600.00', difference: '0.00', closingFloat: '500.00', comment: null, needsReview: false });
    expect(result.plan.counts).toEqual([{ denomination: '200.00', quantity: 3 }]);
  });

  it('asks for the justification when the count differs, and keeps it trimmed', () => {
    const short = input({ counts: [{ denomination: '100', quantity: 5 }, { denomination: '20', quantity: 4 }] });
    expect(planClosing(short, system, '0.00')).toEqual({ ok: false, error: 'CLOSING_COMMENT_REQUIRED' });
    expect(planClosing({ ...short, comment: '   ' }, system, '0.00')).toEqual({ ok: false, error: 'CLOSING_COMMENT_REQUIRED' });
    const ok = planClosing({ ...short, comment: '  Faltó un vuelto  ' }, system, '0.00');
    expect(ok.ok && ok.plan).toMatchObject({ counted: '580.00', difference: '-20.00', needsReview: true, comment: 'Faltó un vuelto' });
  });

  it('asks for the justification when a declared method differs', () => {
    const declared = { QR: '90.00', CARD: '0', TRANSFER: '0' };
    expect(planClosing(input({ declared }), system, '0.00')).toEqual({ ok: false, error: 'CLOSING_COMMENT_REQUIRED' });
    expect(planClosing(input({ declared, comment: 'El banco aún no refleja un QR' }), system, '0.00').ok).toBe(true);
  });

  it('does not ask for a comment inside the tolerance', () => {
    const near = input({ counts: [{ denomination: '200', quantity: 2 }, { denomination: '100', quantity: 1 }, { denomination: '50', quantity: 2 }] });
    expect(planClosing(near, { ...system, expectedCash: '601.00' }, '0.00')).toEqual({ ok: false, error: 'CLOSING_COMMENT_REQUIRED' });
    const withinTolerance = planClosing(near, { ...system, expectedCash: '601.00' }, '1.00');
    expect(withinTolerance.ok && withinTolerance.plan.needsReview).toBe(false);
  });

  it('refuses a float larger than the cash counted', () => {
    expect(planClosing(input({ closingFloat: '600.01' }), system, '0.00')).toEqual({ ok: false, error: 'CLOSING_FLOAT_EXCEEDS_COUNTED' });
    expect(planClosing(input({ closingFloat: '600.00' }), system, '0.00').ok).toBe(true);
    expect(planClosing(input({ closingFloat: '0' }), system, '0.00').ok).toBe(true);
  });

  it.each([
    ['a negative declared amount', { declared: { QR: '-1', CARD: '0', TRANSFER: '0' } }],
    ['a declared amount with 3 decimals', { declared: { QR: '1.001', CARD: '0', TRANSFER: '0' } }],
    ['a missing declared method', { declared: { QR: '1', CARD: '0' } as never }],
    ['a negative float', { closingFloat: '-5' }],
    ['a float that is not a number', { closingFloat: 'abc' }],
  ])('refuses %s', (_label, over) => {
    expect(planClosing(input(over as Partial<CloseCashShiftInput>), system, '0.00')).toEqual({ ok: false, error: 'INVALID_CASH_AMOUNT' });
  });

  it('refuses a bad count before anything else', () => {
    expect(planClosing(input({ counts: [{ denomination: '3', quantity: 1 }] }), system, '0.00')).toEqual({ ok: false, error: 'INVALID_DENOMINATION' });
    expect(planClosing(input({ counts: [{ denomination: '50', quantity: -1 }] }), system, '0.00')).toEqual({ ok: false, error: 'INVALID_COUNT' });
  });

  it('refuses a comment that is too long', () => {
    expect(planClosing(input({ comment: 'x'.repeat(501) }), system, '0.00')).toEqual({ ok: false, error: 'CLOSING_COMMENT_TOO_LONG' });
  });

  it('allows an empty count with a float of zero when the system expects nothing', () => {
    const empty = planClosing(
      input({ counts: [], declared: { QR: '0', CARD: '0', TRANSFER: '0' }, closingFloat: '0' }),
      { expectedCash: '0.00', methods: { QR: '0.00', CARD: '0.00', TRANSFER: '0.00' } },
      '0.00',
    );
    expect(empty.ok && empty.plan.counted).toBe('0.00');
  });
});
