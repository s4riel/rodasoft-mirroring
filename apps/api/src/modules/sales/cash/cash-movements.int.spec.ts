/**
 * Integration test of the manual cash movements (HU-VEN-22) against the real Postgres: an income or expense with its concept,
 * detail and receipt written atomically with its audit and outbox rows, every guard, the idempotency key, the approval of the
 * expenses above the limit (decision #16) and the races between an approval, a withdrawal and other expenses.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Caller } from '../pos/pos.int-fixture';
import { codeOf, createPosFixture } from '../pos/pos.int-fixture';

jest.setTimeout(30_000);

const fx = createPosFixture('cashmov');
const { state } = fx;

const OPEN = 'sales.cash-register.open';
const APPROVE = 'sales.cash-expenses.approve';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const key = () => randomUUID();
const expense = (amount: string, over: Record<string, unknown> = {}) => ({ type: 'EXPENSE', amount, concept: 'FREIGHT', detail: 'Flete a Oruro', ...over });
const income = (amount: string, over: Record<string, unknown> = {}) => ({ type: 'INCOME', amount, concept: 'BALANCE_COLLECTION', ...over });

describe('Cash movements (integration, real Postgres)', () => {
  let approver: Caller;

  beforeAll(async () => {
    await fx.setup();
    fx.useCompany(state.companyId);
    approver = await fx.newMember('approver', state.companyId);
    fx.grant(approver, APPROVE);
  }, 60_000);
  afterAll(() => fx.teardown());
  beforeEach(() => fx.useCompany(state.companyId));
  afterEach(async () => {
    fx.useCompany(state.companyId);
    await state.base.companySetting.deleteMany({ where: { companyId: state.companyId, key: 'sales.cashExpenseApprovalLimit' } });
  });

  /** A cashier with an open shift of Bs 100 who may open and register. */
  async function cashier(label: string, openingFloat = '100.00') {
    const shift = await fx.newShift(label, openingFloat);
    fx.grant(shift.caller, OPEN);
    return shift;
  }

  const svc = (caller: Caller) => fx.as(caller);
  const setLimit = (value: string) =>
    state.base.companySetting.upsert({
      where: { companyId_key: { companyId: state.companyId, key: 'sales.cashExpenseApprovalLimit' } },
      create: { companyId: state.companyId, key: 'sales.cashExpenseApprovalLimit', value },
      update: { value },
    });
  const movementsOf = (shiftId: string) => state.base.cashMovement.findMany({ where: { shiftId }, orderBy: { createdAt: 'asc' } });
  const expectedOf = async (caller: Caller, shiftId: string) => (await svc(caller).cashSummary.shiftDetail(shiftId)).cash.expected;

  describe('registering an income or an expense', () => {
    it('writes the expense with its concept, detail, user and time, audited and in the outbox', async () => {
      const { caller, shiftId } = await cashier('exp-ok');
      const detail = await svc(caller).cashMovements.create(shiftId, expense('30.00'), undefined, key());

      expect(detail).toMatchObject({
        type: 'EXPENSE',
        status: 'POSTED',
        concept: 'FREIGHT',
        detail: 'Flete a Oruro',
        amount: '30.00',
        by: { id: caller.userId },
        hasReceipt: false,
        approval: null,
        canDecide: false,
        canWithdraw: false,
        shift: { id: shiftId, status: 'OPEN' },
      });
      expect(new Date(detail.createdAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
      const audit = await state.base.auditLog.findFirstOrThrow({ where: { companyId: state.companyId, action: 'sales.cash-movement.create', entityId: detail.id } });
      expect(audit).toMatchObject({ entity: 'CashMovement', userId: caller.userId });
      expect(audit.after).toMatchObject({ shiftId, type: 'EXPENSE', amount: '30.00', concept: 'FREIGHT', status: 'POSTED' });
      const event = await state.base.outboxEvent.findFirstOrThrow({ where: { type: 'sales.cash-movement.created', idempotencyKey: `cash-movement-created:${detail.id}` } });
      expect(event.companyId).toBe(state.companyId);
      expect(await expectedOf(caller, shiftId)).toBe('70.00');
    });

    it('writes an income, which raises the expected cash', async () => {
      const { caller, shiftId } = await cashier('inc-ok');
      const detail = await svc(caller).cashMovements.create(shiftId, income('45.50', { detail: ' Cobro de saldo ' }), undefined, key());
      expect(detail).toMatchObject({ type: 'INCOME', status: 'POSTED', concept: 'BALANCE_COLLECTION', detail: 'Cobro de saldo', amount: '45.50' });
      expect(await expectedOf(caller, shiftId)).toBe('145.50');
    });

    it.each([
      ['an amount of zero', expense('0'), 'INVALID_CASH_AMOUNT'],
      ['a negative amount', expense('-1'), 'INVALID_CASH_AMOUNT'],
      ['an amount with 3 decimals', expense('1.005'), 'INVALID_CASH_AMOUNT'],
      ['a concept of the other type', expense('5', { concept: 'BALANCE_COLLECTION' }), 'INVALID_CASH_CONCEPT'],
      ['an unknown concept', income('5', { concept: 'GIFT' }), 'INVALID_CASH_CONCEPT'],
      ['the concept OTHER without a detail', expense('5', { concept: 'OTHER', detail: '  ' }), 'CASH_DETAIL_REQUIRED'],
      ['a type that is not manual', expense('5', { type: 'REFUND' }), 'INVALID_CASH_TYPE'],
    ])('refuses %s and writes nothing', async (_label, input, code) => {
      const { caller, shiftId } = await cashier('guard');
      expect(await codeOf(svc(caller).cashMovements.create(shiftId, input, undefined, key()))).toBe(code);
      expect(await movementsOf(shiftId)).toHaveLength(0);
    });

    it('accepts the concept OTHER with a detail', async () => {
      const { caller, shiftId } = await cashier('other');
      const detail = await svc(caller).cashMovements.create(shiftId, expense('5', { concept: 'OTHER', detail: 'Propina' }), undefined, key());
      expect(detail.concept).toBe('OTHER');
    });

    it('refuses an expense larger than the cash in the register, and accepts one that empties it', async () => {
      const { caller, shiftId } = await cashier('overdraw');
      const attempt = svc(caller).cashMovements.create(shiftId, expense('100.01'), undefined, key());
      expect(await codeOf(attempt)).toBe('CASH_EXPENSE_EXCEEDS_CASH');
      expect(await movementsOf(shiftId)).toHaveLength(0);
      expect(await state.base.auditLog.count({ where: { companyId: state.companyId, action: 'sales.cash-movement.create', userId: caller.userId } })).toBe(0);
      await svc(caller).cashMovements.create(shiftId, expense('100.00'), undefined, key());
      expect(await expectedOf(caller, shiftId)).toBe('0.00');
    });

    it('refuses a closed shift, another cashier’s shift and an unknown shift', async () => {
      const mine = await cashier('closed');
      const theirs = await cashier('theirs');
      await state.base.cashShift.update({ where: { id: mine.shiftId }, data: { status: 'CLOSED' } });
      expect(await codeOf(svc(mine.caller).cashMovements.create(mine.shiftId, income('5'), undefined, key()))).toBe('CASH_SHIFT_NOT_OPEN');
      expect(await codeOf(svc(mine.caller).cashMovements.create(theirs.shiftId, income('5'), undefined, key()))).toBe('CASH_SHIFT_NOT_OWNED');
      expect(await codeOf(svc(mine.caller).cashMovements.create(randomUUID(), income('5'), undefined, key()))).toBe('CASH_SHIFT_NOT_FOUND');
      expect(await movementsOf(theirs.shiftId)).toHaveLength(0);
    });

    it('does not see a shift of another company', async () => {
      const { shiftId } = await cashier('tenant');
      fx.useCompany(state.otherCompanyId);
      expect(await codeOf(svc(state.other).cashMovements.create(shiftId, income('5'), undefined, key()))).toBe('CASH_SHIFT_NOT_FOUND');
    });
  });

  describe('the receipt', () => {
    it('is stored and served to who registered the movement, and to who approves expenses', async () => {
      const { caller, shiftId } = await cashier('receipt');
      const detail = await svc(caller).cashMovements.create(shiftId, expense('10.00'), { buffer: png }, key());
      expect(detail.hasReceipt).toBe(true);
      const row = await state.base.cashMovement.findUniqueOrThrow({ where: { id: detail.id } });
      expect(row.receiptKey).toBe(`${state.companyId}/cash-receipt/${detail.id}_v1.png`);
      expect(existsSync(join(fx.storageDir, row.receiptKey as string))).toBe(true);

      const served = await svc(caller).cashSummary.receipt(detail.id);
      expect(served.getHeaders().type).toBe('image/png');
      expect(await svc(approver).cashSummary.receipt(detail.id)).toBeDefined();
    });

    it('is hidden from another cashier and missing when the movement has none', async () => {
      const { caller, shiftId } = await cashier('receipt-hidden');
      const stranger = await cashier('stranger');
      const withReceipt = await svc(caller).cashMovements.create(shiftId, expense('10.00'), { buffer: png }, key());
      const without = await svc(caller).cashMovements.create(shiftId, expense('5.00'), undefined, key());
      expect(await codeOf(svc(stranger.caller).cashSummary.receipt(withReceipt.id))).toBe('CASH_MOVEMENT_NOT_FOUND');
      expect(await codeOf(svc(caller).cashSummary.receipt(without.id))).toBe('RECEIPT_NOT_FOUND');
    });

    it('refuses a file that is not a photo or a PDF, and one over 5 MB, before writing anything', async () => {
      const { caller, shiftId } = await cashier('receipt-bad');
      expect(await codeOf(svc(caller).cashMovements.create(shiftId, expense('10.00'), { buffer: Buffer.from('MZ\x90\x00') }, key()))).toBe('INVALID_RECEIPT_FILE');
      const big = Buffer.alloc(5 * 1024 * 1024 + 1);
      Buffer.from('%PDF-1.7\n').copy(big);
      expect(await codeOf(svc(caller).cashMovements.create(shiftId, expense('10.00'), { buffer: big }, key()))).toBe('RECEIPT_TOO_LARGE');
      expect(await movementsOf(shiftId)).toHaveLength(0);
    });
  });

  describe('the idempotency key', () => {
    it('returns the movement of the first call when the key is repeated', async () => {
      const { caller, shiftId } = await cashier('idem');
      const k = key();
      const first = await svc(caller).cashMovements.create(shiftId, expense('10.00'), undefined, k);
      const second = await svc(caller).cashMovements.create(shiftId, expense('10.00'), undefined, k);
      expect(second.id).toBe(first.id);
      expect(await movementsOf(shiftId)).toHaveLength(1);
      expect(await expectedOf(caller, shiftId)).toBe('90.00');
    });

    it('registers once when the same key arrives twice at the same time', async () => {
      const { caller, shiftId } = await cashier('idem-race');
      const k = key();
      const results = await Promise.all([
        svc(caller).cashMovements.create(shiftId, expense('10.00'), undefined, k),
        svc(caller).cashMovements.create(shiftId, expense('10.00'), undefined, k),
      ]);
      expect(results[0].id).toBe(results[1].id);
      expect(await movementsOf(shiftId)).toHaveLength(1);
    });

    it('refuses a key that was used for another shift', async () => {
      const a = await cashier('idem-a');
      const b = await cashier('idem-b');
      const k = key();
      await svc(a.caller).cashMovements.create(a.shiftId, income('5'), undefined, k);
      expect(await codeOf(svc(b.caller).cashMovements.create(b.shiftId, income('5'), undefined, k))).toBe('CASH_MOVEMENT_KEY_REUSED');
    });
  });

  describe('the approval of an expense above the limit (decision #16)', () => {
    it('never asks when no limit is configured', async () => {
      const { caller, shiftId } = await cashier('nolimit', '5000.00');
      const detail = await svc(caller).cashMovements.create(shiftId, expense('4000.00'), undefined, key());
      expect(detail.status).toBe('POSTED');
      expect(await state.base.approvalRequest.count({ where: { companyId: state.companyId, type: 'CASH_EXPENSE', subjectId: detail.id } })).toBe(0);
    });

    it('posts an expense at or under the limit at once', async () => {
      await setLimit('100.00');
      const { caller, shiftId } = await cashier('atlimit', '500.00');
      expect((await svc(caller).cashMovements.create(shiftId, expense('100.00'), undefined, key())).status).toBe('POSTED');
    });

    it('leaves an expense over the limit pending, with a request, out of the expected cash', async () => {
      await setLimit('100.00');
      const { caller, shiftId } = await cashier('pending', '500.00');
      const detail = await svc(caller).cashMovements.create(shiftId, expense('150.00'), undefined, key());

      expect(detail).toMatchObject({ status: 'PENDING', canWithdraw: true, canDecide: false, approval: { requestedBy: { id: caller.userId }, decidedBy: null } });
      const request = await state.base.approvalRequest.findFirstOrThrow({ where: { companyId: state.companyId, type: 'CASH_EXPENSE', subjectId: detail.id } });
      expect(request).toMatchObject({ status: 'PENDING', requestedById: caller.userId, reason: 'FREIGHT', requesterComment: 'Flete a Oruro' });
      expect(await expectedOf(caller, shiftId)).toBe('500.00');
      const shift = await svc(caller).cashSummary.shiftDetail(shiftId);
      expect(shift.pendingExpenses).toBe(1);
      expect(await state.base.outboxEvent.count({ where: { type: 'sales.cash-expense.requested', idempotencyKey: `cash-expense-requested:${detail.id}` } })).toBe(1);
      expect(await state.base.outboxEvent.count({ where: { type: 'sales.cash-movement.created', idempotencyKey: `cash-movement-created:${detail.id}` } })).toBe(0);
    });

    it('posts at once when the requester already holds the approval permission', async () => {
      await setLimit('100.00');
      const { caller, shiftId } = await cashier('boss', '500.00');
      fx.grant(caller, OPEN, APPROVE);
      const detail = await svc(caller).cashMovements.create(shiftId, expense('150.00'), undefined, key());
      expect(detail.status).toBe('POSTED');
      expect(await state.base.approvalRequest.count({ where: { companyId: state.companyId, type: 'CASH_EXPENSE', subjectId: detail.id } })).toBe(0);
    });

    it('does not ask for an income, whatever its size', async () => {
      await setLimit('100.00');
      const { caller, shiftId } = await cashier('income-big');
      expect((await svc(caller).cashMovements.create(shiftId, income('900.00'), undefined, key())).status).toBe('POSTED');
    });

    it('posts an approved expense, which then counts in the expected cash, audited and in the outbox', async () => {
      await setLimit('100.00');
      const { caller, shiftId } = await cashier('approve', '500.00');
      const pending = await svc(caller).cashMovements.create(shiftId, expense('150.00'), undefined, key());

      const seen = await svc(approver).cashSummary.movementDetail(pending.id);
      expect(seen).toMatchObject({ canDecide: true, canWithdraw: false });
      const decided = await svc(approver).cashMovements.approve(pending.id, { comment: ' Autorizado ' });

      expect(decided).toMatchObject({ status: 'POSTED', canDecide: false, approval: { decidedBy: { id: approver.userId }, comment: 'Autorizado' } });
      expect(decided.approval?.decidedAt).not.toBeNull();
      expect(await expectedOf(caller, shiftId)).toBe('350.00');
      const request = await state.base.approvalRequest.findFirstOrThrow({ where: { type: 'CASH_EXPENSE', subjectId: pending.id } });
      expect(request).toMatchObject({ status: 'APPROVED', decidedById: approver.userId, comment: 'Autorizado' });
      const audit = await state.base.auditLog.findFirstOrThrow({ where: { action: 'sales.cash-expense.approve', entityId: pending.id } });
      expect(audit).toMatchObject({ userId: approver.userId });
      expect(audit.before).toEqual({ status: 'PENDING' });
      expect(await state.base.outboxEvent.count({ where: { type: 'sales.cash-expense.decided', idempotencyKey: `cash-expense-decided:${pending.id}` } })).toBe(1);
    });

    it('rejects an expense with a reply, and the cash does not change', async () => {
      await setLimit('100.00');
      const { caller, shiftId } = await cashier('reject', '500.00');
      const pending = await svc(caller).cashMovements.create(shiftId, expense('150.00'), undefined, key());
      expect(await codeOf(svc(approver).cashMovements.reject(pending.id, {}))).toBe('VALIDATION_FAILED');
      expect(await codeOf(svc(approver).cashMovements.reject(pending.id, { comment: '   ' }))).toBe('VALIDATION_FAILED');

      const decided = await svc(approver).cashMovements.reject(pending.id, { comment: 'Sin factura' });
      expect(decided).toMatchObject({ status: 'REJECTED', approval: { comment: 'Sin factura' } });
      expect(await expectedOf(caller, shiftId)).toBe('500.00');
      expect((await state.base.approvalRequest.findFirstOrThrow({ where: { type: 'CASH_EXPENSE', subjectId: pending.id } })).status).toBe('REJECTED');
    });

    it('lets the requester withdraw it, and nobody else', async () => {
      await setLimit('100.00');
      const { caller, shiftId } = await cashier('withdraw', '500.00');
      const stranger = await cashier('withdraw-stranger');
      const pending = await svc(caller).cashMovements.create(shiftId, expense('150.00'), undefined, key());
      expect(await codeOf(svc(stranger.caller).cashMovements.withdraw(pending.id))).toBe('CASH_MOVEMENT_NOT_OWNED');

      const decided = await svc(caller).cashMovements.withdraw(pending.id);
      expect(decided).toMatchObject({ status: 'WITHDRAWN', canWithdraw: false });
      expect((await state.base.approvalRequest.findFirstOrThrow({ where: { type: 'CASH_EXPENSE', subjectId: pending.id } })).status).toBe('WITHDRAWN');
      expect(await state.base.auditLog.count({ where: { action: 'sales.cash-expense.withdraw', entityId: pending.id } })).toBe(1);
    });

    it('decides a request only once', async () => {
      await setLimit('100.00');
      const { caller, shiftId } = await cashier('once', '500.00');
      const pending = await svc(caller).cashMovements.create(shiftId, expense('150.00'), undefined, key());
      await svc(approver).cashMovements.approve(pending.id, {});
      expect(await codeOf(svc(approver).cashMovements.approve(pending.id, {}))).toBe('CASH_MOVEMENT_NOT_PENDING');
      expect(await codeOf(svc(approver).cashMovements.reject(pending.id, { comment: 'No' }))).toBe('CASH_MOVEMENT_NOT_PENDING');
      expect(await codeOf(svc(caller).cashMovements.withdraw(pending.id))).toBe('CASH_MOVEMENT_NOT_PENDING');
    });

    it('checks the cash again when approving: the drawer may have emptied in the meantime', async () => {
      await setLimit('100.00');
      const { caller, shiftId } = await cashier('recheck', '200.00');
      const pending = await svc(caller).cashMovements.create(shiftId, expense('150.00'), undefined, key());
      // 120 leaves 80 in the drawer: the pending 150 no longer fits
      await svc(caller).cashMovements.create(shiftId, expense('100.00', { concept: 'SERVICES' }), undefined, key());
      expect(await codeOf(svc(approver).cashMovements.approve(pending.id, {}))).toBe('CASH_EXPENSE_EXCEEDS_CASH');
      expect((await state.base.cashMovement.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('PENDING');
      // it can still be rejected or withdrawn
      expect((await svc(caller).cashMovements.withdraw(pending.id)).status).toBe('WITHDRAWN');
    });

    it('hides an expense from a cashier who did not register it, and from another company', async () => {
      await setLimit('100.00');
      const { caller, shiftId } = await cashier('hidden', '500.00');
      const stranger = await cashier('hidden-stranger');
      const pending = await svc(caller).cashMovements.create(shiftId, expense('150.00'), undefined, key());
      expect(await codeOf(svc(stranger.caller).cashSummary.movementDetail(pending.id))).toBe('CASH_MOVEMENT_NOT_FOUND');
      fx.useCompany(state.otherCompanyId);
      fx.grant(state.other, APPROVE);
      expect(await codeOf(svc(state.other).cashSummary.movementDetail(pending.id))).toBe('CASH_MOVEMENT_NOT_FOUND');
      expect(await codeOf(svc(state.other).cashMovements.approve(pending.id, {}))).toBe('CASH_MOVEMENT_NOT_FOUND');
    });
  });

  describe('concurrency', () => {
    it('lets only one of an approval and a withdrawal win', async () => {
      await setLimit('100.00');
      for (let round = 0; round < 4; round += 1) {
        const { caller, shiftId } = await cashier(`race-aw-${round}`, '500.00');
        const pending = await svc(caller).cashMovements.create(shiftId, expense('150.00'), undefined, key());
        const results = await Promise.allSettled([svc(approver).cashMovements.approve(pending.id, {}), svc(caller).cashMovements.withdraw(pending.id)]);

        const won = results.filter((r) => r.status === 'fulfilled');
        const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
        expect(won).toHaveLength(1);
        expect(lost).toHaveLength(1);
        expect((lost[0].reason as { getResponse: () => { code: string } }).getResponse().code).toBe('CASH_MOVEMENT_NOT_PENDING');
        const stored = await state.base.cashMovement.findUniqueOrThrow({ where: { id: pending.id } });
        const request = await state.base.approvalRequest.findFirstOrThrow({ where: { type: 'CASH_EXPENSE', subjectId: pending.id } });
        // the movement and its request always end in matching states
        expect([`${stored.status}/${request.status}`]).toEqual([stored.status === 'POSTED' ? 'POSTED/APPROVED' : 'WITHDRAWN/WITHDRAWN']);
        expect(await expectedOf(caller, shiftId)).toBe(stored.status === 'POSTED' ? '350.00' : '500.00');
      }
    });

    it('lets only one of two approvals win', async () => {
      await setLimit('100.00');
      const { caller, shiftId } = await cashier('race-aa', '500.00');
      const second = await fx.newMember('approver2', state.companyId);
      fx.grant(second, APPROVE);
      const pending = await svc(caller).cashMovements.create(shiftId, expense('150.00'), undefined, key());
      const results = await Promise.allSettled([svc(approver).cashMovements.approve(pending.id, {}), svc(second).cashMovements.approve(pending.id, {})]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await expectedOf(caller, shiftId)).toBe('350.00');
      expect(await state.base.auditLog.count({ where: { action: 'sales.cash-expense.approve', entityId: pending.id } })).toBe(1);
    });

    it('lets only one of two expenses win when together they would overdraw the register', async () => {
      for (let round = 0; round < 4; round += 1) {
        const { caller, shiftId } = await cashier(`race-ee-${round}`, '100.00');
        const results = await Promise.allSettled([
          svc(caller).cashMovements.create(shiftId, expense('80.00'), undefined, key()),
          svc(caller).cashMovements.create(shiftId, expense('80.00', { concept: 'SERVICES' }), undefined, key()),
        ]);
        const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect((lost[0].reason as { getResponse: () => { code: string } }).getResponse().code).toBe('CASH_EXPENSE_EXCEEDS_CASH');
        expect(await expectedOf(caller, shiftId)).toBe('20.00');
        expect(await movementsOf(shiftId)).toHaveLength(1);
      }
    });
  });
});
