/**
 * Integration test of the cancellation request of a sale (HU-VEN-14) against the real Postgres: the request and its
 * withdrawal, the window of decision #10, who may do what, the concurrent double request, that asking changes nothing else
 * (no stock, cash or invoice), and the audit and outbox rows written with it.
 */
import { randomUUID } from 'node:crypto';
import { codeOf, createPosFixture, type Caller } from '../pos/pos.int-fixture';

const fx = createPosFixture('salecancel');
const { state } = fx;

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Sale cancellation request (integration, real Postgres)', () => {
  /** Sees every sale but cannot approve cancellations. */
  let viewer: Caller;
  /** Sees every sale and may approve cancellations. */
  let approver: Caller;
  let otherApprover: Caller;

  beforeAll(async () => {
    await fx.setup();
    viewer = await fx.newMember('viewer', state.companyId);
    fx.grant(viewer, 'sales.history.view-all');
    approver = await fx.newMember('approver', state.companyId);
    fx.grant(approver, 'sales.history.view-all', 'sales.cancellations.approve');
    otherApprover = await fx.newMember('otherapprover', state.otherCompanyId);
    fx.grant(otherApprover, 'sales.history.view-all', 'sales.cancellations.approve');
  }, 60_000);
  afterAll(() => fx.teardown());
  beforeEach(() => fx.useCompany(state.companyId));

  afterEach(async () => {
    fx.useCompany(state.companyId);
    await state.base.approvalRequest.deleteMany({ where: { companyId: state.companyId } });
    await state.base.invoice.deleteMany({ where: { companyId: state.companyId } });
    await state.base.sale.deleteMany({ where: { companyId: state.companyId } });
    await state.base.cashMovement.deleteMany({ where: { companyId: state.companyId } });
    await state.base.posCheckoutItem.deleteMany({ where: { companyId: state.companyId } });
    await state.base.posCheckout.deleteMany({ where: { companyId: state.companyId } });
    await state.base.outboxEvent.deleteMany({ where: { companyId: state.companyId } });
    await state.base.auditLog.deleteMany({ where: { companyId: state.companyId } });
    await state.base.companySetting.deleteMany({ where: { companyId: state.companyId, key: 'sales.cancellationWindowDays' } });
  });

  const svc = (caller: Caller = state.cashier) => fx.as(caller);
  const input = { reason: 'CUSTOMER_DATA_ERROR', comment: 'El cliente pidió la factura a nombre de otra empresa' };

  /** Sells one unit of a fresh product in cash and returns the sale id. */
  async function sell(caller: Caller = state.cashier): Promise<string> {
    const product = await fx.newProduct({ price: '100.00', stock: { [state.centralId]: 50 } });
    await svc(caller).checkout.addItem({ productId: product.id, quantity: 1 });
    const { total } = await svc(caller).payment.pay();
    const done = await svc(caller).payment.complete({
      payments: [{ method: 'CASH', received: total }],
      expectedTotal: total,
      idempotencyKey: randomUUID(),
    });
    return done.sale.saleId;
  }

  const saleRow = (saleId: string) => state.base.sale.findUniqueOrThrow({ where: { id: saleId }, include: { invoice: true } });
  const requests = (saleId: string) => state.base.approvalRequest.findMany({ where: { subjectId: saleId }, orderBy: { createdAt: 'asc' } });
  const audits = (saleId: string, action: string) => state.base.auditLog.findMany({ where: { entity: 'Sale', entityId: saleId, action } });
  const events = (type: string) => state.base.outboxEvent.findMany({ where: { companyId: state.companyId, type } });
  const setWindow = (days: number | null) =>
    days === null
      ? state.base.companySetting.deleteMany({ where: { companyId: state.companyId, key: 'sales.cancellationWindowDays' } })
      : state.base.companySetting.upsert({
          where: { companyId_key: { companyId: state.companyId, key: 'sales.cancellationWindowDays' } },
          create: { companyId: state.companyId, key: 'sales.cancellationWindowDays', value: days },
          update: { value: days },
        });
  const ageBy = (saleId: string, days: number) =>
    state.base.sale.update({ where: { id: saleId }, data: { createdAt: new Date(Date.now() - days * DAY_MS) } });
  const counts = async () => ({
    stock: await state.base.stockMovement.count({ where: { companyId: state.companyId } }),
    cash: await state.base.cashMovement.count({ where: { companyId: state.companyId } }),
  });

  describe('request', () => {
    it('moves the sale to CANCELLATION_PENDING and stores the reason and the comment', async () => {
      const saleId = await sell();
      const answer = await svc().cancellations.request(saleId, input);
      expect(answer).toEqual({ saleId, status: 'CANCELLATION_PENDING' });
      expect((await saleRow(saleId)).status).toBe('CANCELLATION_PENDING');
      const [request] = await requests(saleId);
      expect(request).toMatchObject({
        type: 'CANCELLATION',
        status: 'PENDING',
        reason: 'CUSTOMER_DATA_ERROR',
        requesterComment: input.comment,
        requestedById: state.cashier.userId,
        decidedById: null,
        comment: null,
      });
    });

    it('trims the comment', async () => {
      const saleId = await sell();
      await svc().cancellations.request(saleId, { reason: 'OTHER', comment: '  precio mal cargado \n' });
      expect((await requests(saleId))[0].requesterComment).toBe('precio mal cargado');
    });

    it('changes nothing else: the invoice stays as it was and no stock or cash moves', async () => {
      const saleId = await sell();
      const before = await counts();
      const invoiceBefore = (await saleRow(saleId)).invoice;
      await svc().cancellations.request(saleId, input);
      expect(await counts()).toEqual(before);
      const invoiceAfter = (await saleRow(saleId)).invoice;
      expect(invoiceAfter?.status).toBe(invoiceBefore?.status);
      expect(invoiceAfter?.number).toBe(invoiceBefore?.number);
    });

    it('writes one audit row and one outbox event with the request', async () => {
      const saleId = await sell();
      await svc().cancellations.request(saleId, input);
      const [request] = await requests(saleId);
      const [audit] = await audits(saleId, 'sales.sale.cancellation-request');
      expect(audit).toMatchObject({ userId: state.cashier.userId });
      expect(audit.before).toEqual({ status: 'COMPLETED' });
      expect(audit.after).toMatchObject({ status: 'CANCELLATION_PENDING', requestId: request.id, reason: 'CUSTOMER_DATA_ERROR' });
      const published = (await events('sales.cancellation.requested')).filter((e) => (e.payload as { saleId: string }).saleId === saleId);
      expect(published).toHaveLength(1);
      expect(published[0].payload).toMatchObject({ requestId: request.id, total: '100.00', requestedById: state.cashier.userId });
      expect(published[0].idempotencyKey).toBe(`cancellation-requested:${request.id}`);
    });

    it.each([
      ['an unknown reason', { reason: 'BORED', comment: 'x' }],
      ['no reason', { reason: '', comment: 'x' }],
      ['a blank comment', { reason: 'OTHER', comment: '   ' }],
      ['a comment that is too long', { reason: 'OTHER', comment: 'a'.repeat(501) }],
    ])('rejects %s and leaves the sale alone', async (_label, body) => {
      const saleId = await sell();
      expect(await codeOf(svc().cancellations.request(saleId, body))).toBe('VALIDATION_FAILED');
      expect((await saleRow(saleId)).status).toBe('COMPLETED');
      expect(await requests(saleId)).toHaveLength(0);
    });

    it('a second request on a pending sale is CANCELLATION_ALREADY_PENDING', async () => {
      const saleId = await sell();
      await svc().cancellations.request(saleId, input);
      expect(await codeOf(svc().cancellations.request(saleId, input))).toBe('CANCELLATION_ALREADY_PENDING');
      expect(await requests(saleId)).toHaveLength(1);
    });

    it('two requests at once: exactly one succeeds and one request exists', async () => {
      const saleId = await sell();
      const outcomes = await Promise.all([
        codeOf(svc(state.cashier).cancellations.request(saleId, input)),
        codeOf(svc(approver).cancellations.request(saleId, { reason: 'OTHER', comment: 'otro motivo' })),
      ]);
      expect(outcomes.filter((code) => code === null)).toHaveLength(1);
      expect(outcomes.filter((code) => code === 'CANCELLATION_ALREADY_PENDING')).toHaveLength(1);
      expect(await requests(saleId)).toHaveLength(1);
      expect(await audits(saleId, 'sales.sale.cancellation-request')).toHaveLength(1);
    });

    it('a cancelled sale is SALE_NOT_CANCELLABLE', async () => {
      const saleId = await sell();
      await state.base.sale.update({ where: { id: saleId }, data: { status: 'CANCELLED' } });
      expect(await codeOf(svc().cancellations.request(saleId, input))).toBe('SALE_NOT_CANCELLABLE');
      expect(await requests(saleId)).toHaveLength(0);
    });

    it('an unknown sale is a 404', async () => {
      expect(await codeOf(svc().cancellations.request(randomUUID(), input))).toBe('SALE_NOT_FOUND');
    });
  });

  describe('the window (decision #10)', () => {
    it('has no limit by default: an old sale can still be asked to be cancelled', async () => {
      const saleId = await sell();
      await ageBy(saleId, 400);
      expect(await codeOf(svc().cancellations.request(saleId, input))).toBeNull();
    });

    it('blocks a sale older than the configured days', async () => {
      await setWindow(2);
      const saleId = await sell();
      await ageBy(saleId, 3);
      expect(await codeOf(svc().cancellations.request(saleId, input))).toBe('CANCELLATION_WINDOW_EXPIRED');
      expect((await saleRow(saleId)).status).toBe('COMPLETED');
      expect(await requests(saleId)).toHaveLength(0);
    });

    it('allows a sale inside the configured days', async () => {
      await setWindow(2);
      const saleId = await sell();
      await ageBy(saleId, 1);
      expect(await codeOf(svc().cancellations.request(saleId, input))).toBeNull();
    });
  });

  describe('who can ask', () => {
    it("another cashier cannot reach someone else's sale: 404", async () => {
      const saleId = await sell(state.cashier);
      expect(await codeOf(svc(state.second).cancellations.request(saleId, input))).toBe('SALE_NOT_FOUND');
      expect((await saleRow(saleId)).status).toBe('COMPLETED');
    });

    it('who sees every sale can ask for any of them', async () => {
      const saleId = await sell(state.cashier);
      expect(await codeOf(svc(viewer).cancellations.request(saleId, input))).toBeNull();
      expect((await requests(saleId))[0].requestedById).toBe(viewer.userId);
    });

    it("another company's user gets 404, even with view-all", async () => {
      const saleId = await sell();
      fx.useCompany(state.otherCompanyId);
      expect(await codeOf(svc(otherApprover).cancellations.request(saleId, input))).toBe('SALE_NOT_FOUND');
      expect(await codeOf(svc(otherApprover).cancellations.withdraw(saleId))).toBe('SALE_NOT_FOUND');
    });
  });

  describe('withdraw', () => {
    it('the requester takes the request back: the sale is COMPLETED again and the request WITHDRAWN', async () => {
      const saleId = await sell();
      await svc().cancellations.request(saleId, input);
      const answer = await svc().cancellations.withdraw(saleId);
      expect(answer).toEqual({ saleId, status: 'COMPLETED' });
      expect((await saleRow(saleId)).status).toBe('COMPLETED');
      const [request] = await requests(saleId);
      expect(request).toMatchObject({ status: 'WITHDRAWN', decidedById: state.cashier.userId });
      expect(request.decidedAt).not.toBeNull();
    });

    it('writes its own audit row and outbox event', async () => {
      const saleId = await sell();
      await svc().cancellations.request(saleId, input);
      await svc().cancellations.withdraw(saleId);
      const [request] = await requests(saleId);
      const [audit] = await audits(saleId, 'sales.sale.cancellation-withdraw');
      expect(audit.before).toEqual({ status: 'CANCELLATION_PENDING' });
      expect(audit.after).toMatchObject({ status: 'COMPLETED', requestId: request.id });
      const published = (await events('sales.cancellation.withdrawn')).filter((e) => (e.payload as { saleId: string }).saleId === saleId);
      expect(published).toHaveLength(1);
      expect(published[0].idempotencyKey).toBe(`cancellation-withdrawn:${request.id}`);
    });

    it('after a withdrawal the sale can be asked again: a new request, the old one stays', async () => {
      const saleId = await sell();
      await svc().cancellations.request(saleId, input);
      await svc().cancellations.withdraw(saleId);
      expect(await codeOf(svc().cancellations.request(saleId, { reason: 'SALE_NOT_COMPLETED', comment: 'otra vez' }))).toBeNull();
      expect((await requests(saleId)).map((r) => r.status)).toEqual(['WITHDRAWN', 'PENDING']);
    });

    it('who sees the sale but did not ask and cannot approve gets 403', async () => {
      const saleId = await sell();
      await svc().cancellations.request(saleId, input);
      expect(await codeOf(svc(viewer).cancellations.withdraw(saleId))).toBe('CANCELLATION_WITHDRAW_FORBIDDEN');
      expect((await saleRow(saleId)).status).toBe('CANCELLATION_PENDING');
    });

    it('who may approve cancellations can withdraw a request someone else made', async () => {
      const saleId = await sell();
      await svc().cancellations.request(saleId, input);
      expect(await codeOf(svc(approver).cancellations.withdraw(saleId))).toBeNull();
      expect((await requests(saleId))[0]).toMatchObject({ status: 'WITHDRAWN', decidedById: approver.userId });
    });

    it('a sale with nothing pending is CANCELLATION_NOT_PENDING', async () => {
      const saleId = await sell();
      expect(await codeOf(svc().cancellations.withdraw(saleId))).toBe('CANCELLATION_NOT_PENDING');
      await svc().cancellations.request(saleId, input);
      await svc().cancellations.withdraw(saleId);
      expect(await codeOf(svc().cancellations.withdraw(saleId))).toBe('CANCELLATION_NOT_PENDING');
    });

    it('withdraw and request at once leave the sale in a state that matches its requests', async () => {
      const saleId = await sell();
      await svc().cancellations.request(saleId, input);
      await Promise.all([
        codeOf(svc().cancellations.withdraw(saleId)),
        codeOf(svc(approver).cancellations.request(saleId, { reason: 'OTHER', comment: 'a la vez' })),
      ]);
      const status = (await saleRow(saleId)).status;
      const pending = (await requests(saleId)).filter((r) => r.status === 'PENDING');
      expect(pending).toHaveLength(status === 'CANCELLATION_PENDING' ? 1 : 0);
    });
  });

  describe('what the detail says', () => {
    it('a fresh sale can be asked; the impact names the warehouse and the register', async () => {
      const saleId = await sell();
      const { cancellation } = await svc().history.detail(saleId);
      expect(cancellation).toMatchObject({ canRequest: true, windowEndsAt: null, pending: null });
      expect(cancellation.impact.warehouseName).toBe('Central');
      expect(cancellation.impact.registerName).toMatch(/^Caja /);
    });

    it('shows the window end when one is configured, and closes it when it passes', async () => {
      await setWindow(1);
      const open = await sell();
      const closed = await sell();
      await ageBy(closed, 5);
      const a = (await svc().history.detail(open)).cancellation;
      expect(a.canRequest).toBe(true);
      expect(Date.parse(a.windowEndsAt as string)).toBeGreaterThan(Date.now());
      const b = (await svc().history.detail(closed)).cancellation;
      expect(b.canRequest).toBe(false);
      expect(Date.parse(b.windowEndsAt as string)).toBeLessThan(Date.now());
    });

    it('a pending sale shows who asked, why and whether the caller may withdraw', async () => {
      const saleId = await sell();
      await svc().cancellations.request(saleId, input);
      const mine = (await svc().history.detail(saleId)).cancellation;
      expect(mine.canRequest).toBe(false);
      expect(mine.pending).toMatchObject({
        reason: 'CUSTOMER_DATA_ERROR',
        comment: input.comment,
        requestedBy: 'User cashier',
        canWithdraw: true,
      });
      expect(Date.parse(mine.pending?.requestedAt as string)).not.toBeNaN();
      expect((await svc(viewer).history.detail(saleId)).cancellation.pending?.canWithdraw).toBe(false);
      expect((await svc(approver).history.detail(saleId)).cancellation.pending?.canWithdraw).toBe(true);
    });

    it('a cancelled sale cannot be asked again', async () => {
      const saleId = await sell();
      await state.base.sale.update({ where: { id: saleId }, data: { status: 'CANCELLED' } });
      expect((await svc().history.detail(saleId)).cancellation.canRequest).toBe(false);
    });

    it('the history lists the request and the withdrawal, with who did them', async () => {
      const saleId = await sell();
      await svc().cancellations.request(saleId, input);
      await svc(approver).cancellations.withdraw(saleId);
      const { history } = await svc().history.detail(saleId);
      const entries = history.filter((h) => h.action.startsWith('sales.sale.cancellation'));
      expect(entries.map((h) => [h.action, h.userName])).toEqual([
        ['sales.sale.cancellation-request', 'User cashier'],
        ['sales.sale.cancellation-withdraw', 'User approver'],
      ]);
      // only the e-mail address of a receipt request ever travels: never the reason or the comment
      expect(JSON.stringify(history)).not.toContain(input.comment);
    });

    it('the list shows the new status', async () => {
      const saleId = await sell();
      await svc().cancellations.request(saleId, input);
      const page = await svc().history.list({ status: 'CANCELLATION_PENDING' });
      expect(page.items.map((i) => i.id)).toEqual([saleId]);
    });
  });
});
