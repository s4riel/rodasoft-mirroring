/**
 * Integration test of the review of a cash closing (HU-VEN-24) against the real Postgres: what the reviewer reads (difference,
 * cashier's comment, per-method totals, audit trail), approving and observing through the state machines, the audit and outbox
 * rows written with the decision, every guard, and two reviewers deciding at once.
 */
import { randomUUID } from 'node:crypto';
import type { Caller } from '../pos/pos.int-fixture';
import { codeOf, createPosFixture } from '../pos/pos.int-fixture';

jest.setTimeout(30_000);

const fx = createPosFixture('cashreview');
const { state } = fx;
const run = randomUUID().slice(0, 8);

const OPEN = 'sales.cash-register.open';
const REVIEW = 'sales.cash-register.review';

const count = (denomination: string, quantity: number) => ({ denomination, quantity });
/** Bs 580 counted against Bs 600 expected, QR Bs 10 short, Bs 100 left in the register. */
const SHORT = {
  counts: [count('100', 5), count('20', 4)],
  declared: { QR: '90.00', CARD: '0', TRANSFER: '0' },
  closingFloat: '100.00',
  comment: 'Faltó un vuelto de Bs 20',
};
const CLEAN = { counts: [count('200', 3)], declared: { QR: '100.00', CARD: '0', TRANSFER: '0' }, closingFloat: '500.00' };

describe('Reviewing a cash closing (integration, real Postgres)', () => {
  let seq = 0;
  let accountant: Caller;
  let secondAccountant: Caller;

  beforeAll(async () => {
    await fx.setup();
    accountant = await fx.newMember('accountant', state.companyId);
    secondAccountant = await fx.newMember('accountant2', state.companyId);
    fx.grant(accountant, REVIEW);
    fx.grant(secondAccountant, REVIEW);
  }, 60_000);
  afterAll(() => fx.teardown());
  beforeEach(() => fx.useCompany(state.companyId));

  /** A cashier whose shift expects Bs 600 in cash (100 float + 500 in cash sales) and Bs 100 in QR. */
  async function openShift(label: string) {
    const shift = await fx.newShift(label, '100.00');
    fx.grant(shift.caller, OPEN);
    await addSale(shift, 'CASH', '500.00');
    await addSale(shift, 'QR', '100.00');
    return shift;
  }

  async function addSale(shift: { shiftId: string; caller: Caller }, method: 'CASH' | 'QR', amount: string) {
    seq += 1;
    const checkout = await state.base.posCheckout.create({
      data: { companyId: state.companyId, cashierId: shift.caller.userId, shiftId: shift.shiftId, status: 'COMPLETED' },
    });
    const sale = await state.base.sale.create({
      data: {
        companyId: state.companyId,
        checkoutId: checkout.id,
        number: `V-${run}-${seq}`,
        branchId: state.branchId,
        warehouseId: state.centralId,
        shiftId: shift.shiftId,
        status: 'COMPLETED',
        subtotal: amount,
        total: amount,
        createdById: shift.caller.userId,
        payments: { create: [{ companyId: state.companyId, method, amount }] },
      },
    });
    if (method === 'CASH') {
      await state.base.cashMovement.create({
        data: { companyId: state.companyId, shiftId: shift.shiftId, type: 'SALE_PAYMENT', amount, userId: shift.caller.userId, refType: 'SALE', refId: sale.id },
      });
    }
  }

  /** A shift closed Bs 20 short: `CLOSED`, waiting for Accounting. */
  async function pendingShift(label: string) {
    const shift = await openShift(label);
    await fx.as(shift.caller).cashClosing.close(shift.shiftId, SHORT);
    return shift;
  }

  const svc = (caller: Caller) => fx.as(caller).cashReview;
  const shiftRow = (id: string) => state.base.cashShift.findUniqueOrThrow({ where: { id } });
  const request = (shiftId: string) =>
    state.base.approvalRequest.findFirstOrThrow({ where: { companyId: state.companyId, type: 'CASH_DIFFERENCE', subjectId: shiftId } });
  const decisionAudits = (shiftId: string) =>
    state.base.auditLog.findMany({
      where: { companyId: state.companyId, entityId: shiftId, action: { in: ['sales.cash-shift.approve', 'sales.cash-shift.observe'] } },
    });

  describe('what the reviewer reads', () => {
    it('shows the difference, the cashier comment, the deposit and each payment method', async () => {
      const { shiftId, caller, registerId } = await pendingShift('read');
      const review = await svc(accountant).review(shiftId);

      expect(review).toMatchObject({
        id: shiftId,
        status: 'CLOSED',
        displayStatus: 'PENDING_REVIEW',
        register: { id: registerId },
        branch: { id: state.branchId, name: 'Sucursal central' },
        cashier: { id: caller.userId },
        expected: '600.00',
        counted: '580.00',
        difference: '-20.00',
        sales: { total: '600.00', count: 2 },
        closingComment: 'Faltó un vuelto de Bs 20',
        closingFloat: '100.00',
        // 580 counted − 100 left in the register
        deposit: '480.00',
        review: null,
        canDecide: true,
      });
      expect(review.number).toBe((await shiftRow(shiftId)).number);
      expect(review.cashier.name).toContain('User read');
      expect(review.closedAt).not.toBeNull();
      // cash first, then the declared methods, each with system, declared and difference
      expect(review.methods).toEqual([
        { method: 'CASH', system: '600.00', declared: '580.00', difference: '-20.00' },
        { method: 'QR', system: '100.00', declared: '90.00', difference: '-10.00' },
        { method: 'CARD', system: '0.00', declared: '0.00', difference: '0.00' },
        { method: 'TRANSFER', system: '0.00', declared: '0.00', difference: '0.00' },
      ]);
    });

    it('lists the closing in the audit trail with who did it', async () => {
      const { shiftId, caller } = await pendingShift('trail');
      const { timeline } = await svc(accountant).review(shiftId);
      expect(timeline).toHaveLength(1);
      expect(timeline[0]).toMatchObject({ action: 'CLOSE', by: { id: caller.userId }, automatic: false });
      expect(timeline[0].by?.name).toContain('User trail');
    });

    it('lets the cashier read their own closing without deciding it', async () => {
      const { shiftId, caller } = await pendingShift('own-read');
      const review = await svc(caller).review(shiftId);
      expect(review).toMatchObject({ id: shiftId, difference: '-20.00', canDecide: false });
    });

    it('hides the closing of another cashier from who does not review', async () => {
      const { shiftId } = await pendingShift('foreign');
      const stranger = await fx.newMember('stranger', state.companyId);
      fx.grant(stranger, OPEN);
      expect(await codeOf(svc(stranger).review(shiftId))).toBe('CASH_SHIFT_NOT_OWNED');
    });

    it('answers CASH_SHIFT_NOT_FOUND for an unknown shift, another company and a branch the reviewer cannot operate', async () => {
      const { shiftId } = await pendingShift('hidden');
      expect(await codeOf(svc(accountant).review(randomUUID()))).toBe('CASH_SHIFT_NOT_FOUND');
      expect(await codeOf(fx.as(accountant, { operableBranchIds: [randomUUID()] }).cashReview.review(shiftId))).toBe('CASH_SHIFT_NOT_FOUND');

      const foreign = await fx.newMember('foreign-acct', state.otherCompanyId);
      fx.grant(foreign, REVIEW);
      fx.useCompany(state.otherCompanyId);
      expect(await codeOf(svc(foreign).review(shiftId))).toBe('CASH_SHIFT_NOT_FOUND');
      expect(await codeOf(svc(foreign).approve(shiftId, {}))).toBe('CASH_SHIFT_NOT_FOUND');
      fx.useCompany(state.companyId);
      expect((await shiftRow(shiftId)).status).toBe('CLOSED');
    });

    it('shows a closing without difference as closed clean, approved by the system', async () => {
      const shift = await openShift('clean');
      await fx.as(shift.caller).cashClosing.close(shift.shiftId, CLEAN);
      const review = await svc(accountant).review(shift.shiftId);
      expect(review).toMatchObject({ status: 'APPROVED', displayStatus: 'CLOSED_CLEAN', difference: '0.00', review: null, canDecide: false });
      expect(review.timeline.map((t) => [t.action, t.automatic])).toEqual(
        expect.arrayContaining([
          ['CLOSE', false],
          ['APPROVE', true],
        ]),
      );
    });
  });

  describe('approving', () => {
    it('moves the shift CLOSED → APPROVED with the reviewer, the answer and the request approved', async () => {
      const { shiftId } = await pendingShift('approve');
      const review = await svc(accountant).approve(shiftId, { comment: '  Se acepta el faltante  ' });

      expect(review).toMatchObject({
        status: 'APPROVED',
        displayStatus: 'DIFFERENCE_APPROVED',
        canDecide: false,
        review: { by: { id: accountant.userId }, note: 'Se acepta el faltante' },
      });
      const shift = await shiftRow(shiftId);
      expect(shift).toMatchObject({ status: 'APPROVED', reviewedById: accountant.userId, reviewNote: 'Se acepta el faltante' });
      expect(shift.reviewedAt).not.toBeNull();
      expect(await request(shiftId)).toMatchObject({ status: 'APPROVED', decidedById: accountant.userId, comment: 'Se acepta el faltante' });
      expect(review.timeline.map((t) => t.action)).toEqual(['CLOSE', 'APPROVE']);
      expect(review.timeline[1]).toMatchObject({ by: { id: accountant.userId }, automatic: false });
    });

    it('does not need an answer', async () => {
      const { shiftId } = await pendingShift('approve-silent');
      const review = await svc(accountant).approve(shiftId, {});
      expect(review.review).toMatchObject({ note: null });
      expect((await shiftRow(shiftId)).reviewNote).toBeNull();
    });

    it('keeps the audit row and the outbox event of the decision', async () => {
      const { shiftId, caller } = await pendingShift('approve-audit');
      await svc(accountant).approve(shiftId, { comment: 'Conforme' });

      const audits = await decisionAudits(shiftId);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ action: 'sales.cash-shift.approve', entity: 'CashShift', userId: accountant.userId });
      expect(audits[0].before).toEqual({ status: 'CLOSED' });
      expect(audits[0].after).toMatchObject({ status: 'APPROVED', reviewedById: accountant.userId, reviewNote: 'Conforme', differenceAmount: '-20.00' });
      const events = await state.base.outboxEvent.findMany({ where: { idempotencyKey: `cash-shift-reviewed:${shiftId}` } });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: 'sales.cash-shift.reviewed', companyId: state.companyId });
      expect(events[0].payload).toMatchObject({ shiftId, status: 'APPROVED', cashierId: caller.userId, reviewedById: accountant.userId, comment: 'Conforme' });
    });
  });

  describe('observing ("Pedir recuento")', () => {
    it('needs a comment and writes nothing without one', async () => {
      const { shiftId } = await pendingShift('observe-empty');
      expect(await codeOf(svc(accountant).observe(shiftId, {}))).toBe('REVIEW_COMMENT_REQUIRED');
      expect(await codeOf(svc(accountant).observe(shiftId, { comment: '   ' }))).toBe('REVIEW_COMMENT_REQUIRED');
      expect((await shiftRow(shiftId)).status).toBe('CLOSED');
      expect((await request(shiftId)).status).toBe('PENDING');
      expect(await decisionAudits(shiftId)).toHaveLength(0);
    });

    it('moves the shift CLOSED → OBSERVED and rejects the request', async () => {
      const { shiftId } = await pendingShift('observe');
      const review = await svc(accountant).observe(shiftId, { comment: 'Recontar los billetes de 20' });

      expect(review).toMatchObject({ status: 'OBSERVED', displayStatus: 'OBSERVED', canDecide: false, review: { note: 'Recontar los billetes de 20' } });
      expect(await shiftRow(shiftId)).toMatchObject({ status: 'OBSERVED', reviewedById: accountant.userId, reviewNote: 'Recontar los billetes de 20' });
      expect(await request(shiftId)).toMatchObject({ status: 'REJECTED', decidedById: accountant.userId, comment: 'Recontar los billetes de 20' });
      const audits = await decisionAudits(shiftId);
      expect(audits.map((a) => a.action)).toEqual(['sales.cash-shift.observe']);
      expect(audits[0].after).toMatchObject({ status: 'OBSERVED' });
      const event = await state.base.outboxEvent.findFirstOrThrow({ where: { idempotencyKey: `cash-shift-reviewed:${shiftId}` } });
      expect(event.payload).toMatchObject({ status: 'OBSERVED' });
    });

    it('refuses an answer longer than the limit', async () => {
      const { shiftId } = await pendingShift('observe-long');
      expect(await codeOf(svc(accountant).observe(shiftId, { comment: 'x'.repeat(501) }))).toBe('REVIEW_COMMENT_TOO_LONG');
      expect(await codeOf(svc(accountant).approve(shiftId, { comment: 'x'.repeat(501) }))).toBe('REVIEW_COMMENT_TOO_LONG');
      expect((await shiftRow(shiftId)).status).toBe('CLOSED');
    });
  });

  describe('guards', () => {
    it('only decides a closed shift waiting for review', async () => {
      const open = await openShift('still-open');
      expect(await codeOf(svc(accountant).approve(open.shiftId, {}))).toBe('CASH_SHIFT_NOT_CLOSED');

      const clean = await openShift('auto-approved');
      await fx.as(clean.caller).cashClosing.close(clean.shiftId, CLEAN);
      expect(await codeOf(svc(accountant).observe(clean.shiftId, { comment: 'Tarde' }))).toBe('CASH_SHIFT_NOT_CLOSED');
      expect((await shiftRow(clean.shiftId)).reviewedById).toBeNull();
    });

    it('does not decide twice', async () => {
      const { shiftId } = await pendingShift('twice');
      await svc(accountant).approve(shiftId, {});
      expect(await codeOf(svc(secondAccountant).observe(shiftId, { comment: 'Otra opinión' }))).toBe('CASH_SHIFT_NOT_CLOSED');
      expect(await codeOf(svc(secondAccountant).approve(shiftId, {}))).toBe('CASH_SHIFT_NOT_CLOSED');
      expect(await shiftRow(shiftId)).toMatchObject({ status: 'APPROVED', reviewedById: accountant.userId });
      expect(await decisionAudits(shiftId)).toHaveLength(1);
    });

    it('never lets a user review their own shift, even with the permission', async () => {
      const { shiftId, caller } = await pendingShift('self');
      fx.grant(caller, OPEN, REVIEW);
      expect(await codeOf(svc(caller).approve(shiftId, {}))).toBe('CASH_SHIFT_SELF_REVIEW');
      expect(await codeOf(svc(caller).observe(shiftId, { comment: 'Yo mismo' }))).toBe('CASH_SHIFT_SELF_REVIEW');
      expect((await svc(caller).review(shiftId)).canDecide).toBe(false);
      expect((await shiftRow(shiftId)).status).toBe('CLOSED');
    });

    it('does not decide a shift of a branch the reviewer cannot operate', async () => {
      const { shiftId } = await pendingShift('branch');
      expect(await codeOf(fx.as(accountant, { operableBranchIds: [randomUUID()] }).cashReview.approve(shiftId, {}))).toBe('CASH_SHIFT_NOT_FOUND');
      expect((await shiftRow(shiftId)).status).toBe('CLOSED');
    });
  });

  describe('concurrency', () => {
    it('approve × observe: exactly one wins and one decision is recorded', async () => {
      const { shiftId } = await pendingShift('race-mixed');
      const results = await Promise.all([
        codeOf(svc(accountant).approve(shiftId, { comment: 'Conforme' })),
        codeOf(svc(secondAccountant).observe(shiftId, { comment: 'Recontar' })),
      ]);

      expect(results.filter((r) => r === null)).toHaveLength(1);
      expect(results.filter((r) => r === 'CASH_SHIFT_NOT_CLOSED')).toHaveLength(1);
      const shift = await shiftRow(shiftId);
      const approved = results[0] === null;
      expect(shift).toMatchObject({ status: approved ? 'APPROVED' : 'OBSERVED', reviewedById: approved ? accountant.userId : secondAccountant.userId });
      expect((await request(shiftId)).status).toBe(approved ? 'APPROVED' : 'REJECTED');
      expect(await decisionAudits(shiftId)).toHaveLength(1);
      expect(await state.base.outboxEvent.count({ where: { idempotencyKey: `cash-shift-reviewed:${shiftId}` } })).toBe(1);
    });

    it('approve × approve by eight reviewers: exactly one wins', async () => {
      const { shiftId } = await pendingShift('race-approve');
      const reviewers: Caller[] = [];
      for (let i = 0; i < 8; i++) {
        const reviewer = await fx.newMember(`racer${i}`, state.companyId);
        fx.grant(reviewer, REVIEW);
        reviewers.push(reviewer);
      }
      const results = await Promise.all(reviewers.map((r) => codeOf(svc(r).approve(shiftId, {}))));

      expect(results.filter((r) => r === null)).toHaveLength(1);
      expect(results.filter((r) => r === 'CASH_SHIFT_NOT_CLOSED')).toHaveLength(7);
      expect((await shiftRow(shiftId)).reviewedById).toBe(reviewers[results.indexOf(null)].userId);
      expect(await decisionAudits(shiftId)).toHaveLength(1);
      expect(await state.base.outboxEvent.count({ where: { idempotencyKey: `cash-shift-reviewed:${shiftId}` } })).toBe(1);
    });
  });
});
