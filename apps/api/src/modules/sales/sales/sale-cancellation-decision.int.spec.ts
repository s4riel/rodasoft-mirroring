/**
 * Integration test of the decision on a cancellation request (HU-VEN-15) against the real Postgres: what an approval undoes
 * (sale, invoice, stock, cash), that it is atomic and happens once under concurrency, the rejection with its reply, the
 * register that has no open shift to take the refund, and who may decide.
 */
import { randomUUID } from 'node:crypto';
import { codeOf, createPosFixture, type Caller } from '../pos/pos.int-fixture';

const fx = createPosFixture('salecanceldec');
const { state } = fx;

describe('Sale cancellation decision (integration, real Postgres)', () => {
  let approver: Caller;
  /** A second approver of the same company, so two decisions at once come from two callers. */
  let secondApprover: Caller;
  let otherApprover: Caller;

  beforeAll(async () => {
    await fx.setup();
    approver = await fx.newMember('approver', state.companyId);
    fx.grant(approver, 'sales.history.view-all', 'sales.cancellations.approve');
    secondApprover = await fx.newMember('approver2', state.companyId);
    fx.grant(secondApprover, 'sales.history.view-all', 'sales.cancellations.approve');
    otherApprover = await fx.newMember('otherapprover', state.otherCompanyId);
    fx.grant(otherApprover, 'sales.history.view-all', 'sales.cancellations.approve');
  }, 60_000);
  afterAll(() => fx.teardown());
  beforeEach(() => fx.useCompany(state.companyId));

  afterEach(async () => {
    fx.useCompany(state.companyId);
    await state.base.cashShift.updateMany({ where: { companyId: state.companyId, status: 'CLOSED' }, data: { status: 'OPEN' } });
    await state.base.approvalRequest.deleteMany({ where: { companyId: state.companyId } });
    await state.base.invoice.deleteMany({ where: { companyId: state.companyId } });
    await state.base.sale.deleteMany({ where: { companyId: state.companyId } });
    await state.base.cashMovement.deleteMany({ where: { companyId: state.companyId } });
    await state.base.posCheckoutItem.deleteMany({ where: { companyId: state.companyId } });
    await state.base.posCheckout.deleteMany({ where: { companyId: state.companyId } });
    await state.base.outboxEvent.deleteMany({ where: { companyId: state.companyId } });
    await state.base.auditLog.deleteMany({ where: { companyId: state.companyId } });
  });

  const svc = (caller: Caller = state.cashier) => fx.as(caller);
  const input = { reason: 'CUSTOMER_DATA_ERROR', comment: 'El cliente pidió la factura a nombre de otra empresa' };

  /** Sells `quantity` units of a fresh product in cash, asks for the cancellation, and returns the ids. */
  async function sellAndAsk(quantity = 2): Promise<{ saleId: string; productId: string }> {
    const product = await fx.newProduct({ price: '100.00', stock: { [state.centralId]: 50 } });
    await svc().checkout.addItem({ productId: product.id, quantity });
    const { total } = await svc().payment.pay();
    const done = await svc().payment.complete({
      payments: [{ method: 'CASH', received: total }],
      expectedTotal: total,
      idempotencyKey: randomUUID(),
    });
    const saleId = done.sale.saleId;
    await svc().cancellations.request(saleId, input);
    return { saleId, productId: product.id };
  }

  const approve = (saleId: string, comment?: string, caller: Caller = approver) => svc(caller).cancellations.approve(saleId, { comment });
  const reject = (saleId: string, comment?: string, caller: Caller = approver) => svc(caller).cancellations.reject(saleId, { comment });
  const saleRow = (saleId: string) => state.base.sale.findUniqueOrThrow({ where: { id: saleId }, include: { invoice: true } });
  const requests = (saleId: string) => state.base.approvalRequest.findMany({ where: { subjectId: saleId }, orderBy: { createdAt: 'asc' } });
  const audits = (saleId: string, action: string) => state.base.auditLog.findMany({ where: { entity: 'Sale', entityId: saleId, action } });
  const events = (type: string) => state.base.outboxEvent.findMany({ where: { companyId: state.companyId, type } });
  const onHand = async (productId: string) =>
    (await state.base.stockLevel.findFirstOrThrow({ where: { productId, warehouseId: state.centralId } })).quantity;
  const counts = async () => ({
    stock: await state.base.stockMovement.count({ where: { companyId: state.companyId } }),
    cash: await state.base.cashMovement.count({ where: { companyId: state.companyId } }),
  });

  describe('review', () => {
    it('shows the request, the amount, the invoice and what an approval will do', async () => {
      const { saleId } = await sellAndAsk(2);
      const review = await svc(approver).cancellations.review(saleId);
      expect(review.request).toMatchObject({ reason: 'CUSTOMER_DATA_ERROR', comment: input.comment, requestedBy: 'User cashier' });
      expect(review.sale).toMatchObject({ total: '200.00', invoice: { status: 'PENDING', number: null } });
      expect(review.impact).toMatchObject({
        invoiceAction: 'VOID',
        stockUnits: 2,
        cashRefund: '200.00',
        manualRefunds: [],
        shiftOpen: true,
      });
      expect(review.audit.map((entry) => entry.action)).toContain('sales.sale.cancellation-request');
    });

    it('lists the QR part of a mixed sale as a refund to make by hand, and keeps the cash for the register', async () => {
      const { saleId } = await sellAndAsk(1);
      await state.base.salePayment.create({ data: { companyId: state.companyId, saleId, method: 'QR', amount: '50.00', providerStatus: 'CONFIRMED' } });
      const { impact } = await svc(approver).cancellations.review(saleId);
      expect(impact.cashRefund).toBe('100.00');
      expect(impact.manualRefunds).toEqual([{ method: 'QR', amount: '50.00' }]);
    });

    it('says the shift is closed when the register has none open', async () => {
      const { saleId } = await sellAndAsk(1);
      await state.base.cashShift.updateMany({ where: { companyId: state.companyId, status: 'OPEN' }, data: { status: 'CLOSED' } });
      expect((await svc(approver).cancellations.review(saleId)).impact.shiftOpen).toBe(false);
    });

    it('is CANCELLATION_NOT_PENDING when nothing waits for a decision', async () => {
      const { saleId } = await sellAndAsk(1);
      await svc().cancellations.withdraw(saleId);
      expect(await codeOf(svc(approver).cancellations.review(saleId))).toBe('CANCELLATION_NOT_PENDING');
    });
  });

  describe('approve', () => {
    it('cancels the sale, voids the invoice, returns the stock and refunds the cash', async () => {
      const { saleId, productId } = await sellAndAsk(2);
      expect(await onHand(productId)).toBe(48);
      const answer = await approve(saleId, 'Aprobado. Volver a emitir con la razón social correcta.');
      expect(answer).toEqual({ saleId, status: 'CANCELLED' });

      const sale = await saleRow(saleId);
      expect(sale.status).toBe('CANCELLED');
      expect(sale.invoice?.status).toBe('CANCELLED');
      const [request] = await requests(saleId);
      expect(request).toMatchObject({
        status: 'APPROVED',
        decidedById: approver.userId,
        comment: 'Aprobado. Volver a emitir con la razón social correcta.',
      });
      expect(request.decidedAt).not.toBeNull();

      expect(await onHand(productId)).toBe(50);
      const returned = await state.base.stockMovement.findMany({ where: { productId, type: 'SALE_CANCELLATION' } });
      expect(returned).toHaveLength(1);
      expect(returned[0]).toMatchObject({ quantity: 2, balanceAfter: 50, warehouseId: state.centralId, refType: 'SALE', refId: saleId });

      const refunds = await state.base.cashMovement.findMany({ where: { refId: saleId, type: 'REFUND' } });
      expect(refunds).toHaveLength(1);
      expect(refunds[0].amount.toFixed(2)).toBe('200.00');
      expect(refunds[0].userId).toBe(approver.userId);
    });

    it('takes no reply as null', async () => {
      const { saleId } = await sellAndAsk(1);
      await approve(saleId);
      expect((await requests(saleId))[0].comment).toBeNull();
    });

    it('writes one audit row and one outbox event with the decision', async () => {
      const { saleId } = await sellAndAsk(1);
      await approve(saleId);
      const [request] = await requests(saleId);
      const [audit] = await audits(saleId, 'sales.sale.cancellation-approve');
      expect(audit).toMatchObject({ userId: approver.userId });
      expect(audit.before).toMatchObject({ status: 'CANCELLATION_PENDING', invoiceStatus: 'PENDING' });
      expect(audit.after).toMatchObject({ status: 'CANCELLED', invoiceStatus: 'CANCELLED', requestId: request.id, stockUnits: 1, cashRefund: '100.00' });
      const published = (await events('sales.cancellation.approved')).filter((e) => (e.payload as { saleId: string }).saleId === saleId);
      expect(published).toHaveLength(1);
      expect(published[0].payload).toMatchObject({ requestId: request.id, requestedById: state.cashier.userId, decidedById: approver.userId, cashRefund: '100.00' });
      expect(published[0].idempotencyKey).toBe(`cancellation-approved:${request.id}`);
    });

    it('asks the SIAT to cancel an invoice that is already valid instead of voiding it', async () => {
      const { saleId } = await sellAndAsk(1);
      await state.base.invoice.update({ where: { saleId }, data: { status: 'VALID', number: 1528 } });
      await approve(saleId);
      expect((await saleRow(saleId)).invoice?.status).toBe('CANCELLATION_PENDING');
      expect((await saleRow(saleId)).status).toBe('CANCELLED');
    });

    it('refuses an invoice that cannot be cancelled and writes nothing', async () => {
      const { saleId, productId } = await sellAndAsk(1);
      await state.base.invoice.update({ where: { saleId }, data: { status: 'SENDING' } });
      const before = await counts();
      expect(await codeOf(approve(saleId))).toBe('INVOICE_NOT_CANCELLABLE');
      expect(await counts()).toEqual(before);
      expect((await saleRow(saleId)).status).toBe('CANCELLATION_PENDING');
      expect((await requests(saleId))[0].status).toBe('PENDING');
      expect(await onHand(productId)).toBe(49);
    });

    it('is refused when the register of the sale has no open shift, and nothing is written', async () => {
      const { saleId, productId } = await sellAndAsk(1);
      await state.base.cashShift.updateMany({ where: { companyId: state.companyId, status: 'OPEN' }, data: { status: 'CLOSED' } });
      const before = await counts();
      expect(await codeOf(approve(saleId))).toBe('CASH_SHIFT_NOT_OPEN_FOR_REFUND');
      expect(await counts()).toEqual(before);
      expect((await saleRow(saleId)).status).toBe('CANCELLATION_PENDING');
      expect(await onHand(productId)).toBe(49);
    });

    it('leaves the QR part to be refunded by hand and refunds only the cash', async () => {
      const { saleId } = await sellAndAsk(1);
      await state.base.salePayment.create({ data: { companyId: state.companyId, saleId, method: 'QR', amount: '50.00', providerStatus: 'CONFIRMED' } });
      await approve(saleId);
      const refunds = await state.base.cashMovement.findMany({ where: { refId: saleId, type: 'REFUND' } });
      expect(refunds.map((r) => r.amount.toFixed(2))).toEqual(['100.00']);
      const [published] = await events('sales.cancellation.approved');
      expect(published.payload).toMatchObject({ manualRefunds: [{ method: 'QR', amount: '50.00' }] });
    });

    it('a second approval is CANCELLATION_NOT_PENDING and returns nothing twice', async () => {
      const { saleId, productId } = await sellAndAsk(2);
      await approve(saleId);
      expect(await codeOf(approve(saleId))).toBe('CANCELLATION_NOT_PENDING');
      expect(await onHand(productId)).toBe(50);
    });

    it('a sale that was never asked about is CANCELLATION_NOT_PENDING', async () => {
      const { saleId } = await sellAndAsk(1);
      await svc().cancellations.withdraw(saleId);
      expect(await codeOf(approve(saleId))).toBe('CANCELLATION_NOT_PENDING');
    });

    it('a manager may approve a request they made themselves', async () => {
      const { saleId } = await sellAndAsk(1);
      await svc().cancellations.withdraw(saleId);
      await svc(approver).cancellations.request(saleId, input);
      expect(await approve(saleId)).toEqual({ saleId, status: 'CANCELLED' });
    });

    it('rejects a reply that is too long', async () => {
      const { saleId } = await sellAndAsk(1);
      expect(await codeOf(approve(saleId, 'a'.repeat(501)))).toBe('VALIDATION_FAILED');
      expect((await saleRow(saleId)).status).toBe('CANCELLATION_PENDING');
    });

    it('an inactive warehouse is CANCELLATION_WAREHOUSE_INACTIVE and nothing is written', async () => {
      const { saleId, productId } = await sellAndAsk(1);
      await state.base.warehouse.update({ where: { id: state.centralId }, data: { status: 'INACTIVE' } });
      try {
        const before = await counts();
        expect(await codeOf(approve(saleId))).toBe('CANCELLATION_WAREHOUSE_INACTIVE');
        expect(await counts()).toEqual(before);
        expect((await saleRow(saleId)).status).toBe('CANCELLATION_PENDING');
        expect((await requests(saleId))[0].status).toBe('PENDING');
      } finally {
        await state.base.warehouse.update({ where: { id: state.centralId }, data: { status: 'ACTIVE' } });
      }
      expect(await onHand(productId)).toBe(49);
      expect(await approve(saleId)).toEqual({ saleId, status: 'CANCELLED' });
      expect(await onHand(productId)).toBe(50);
    });

    it('approving while another register sells the same product: both finish, no deadlock, the stock adds up', async () => {
      const { saleId, productId } = await sellAndAsk(2);
      expect(await onHand(productId)).toBe(48);
      const other = svc(state.second);
      await other.checkout.addItem({ productId, quantity: 3 });
      const { total } = await other.payment.pay();
      const results = await Promise.allSettled([
        approve(saleId),
        other.payment.complete({ payments: [{ method: 'CASH', received: total }], expectedTotal: total, idempotencyKey: randomUUID() }),
      ]);
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
      // 50 at the start, 2 sold and returned, 3 sold by the other register
      expect(await onHand(productId)).toBe(47);
      expect((await saleRow(saleId)).status).toBe('CANCELLED');
    });

    it('two approvals at once: exactly one wins and the stock comes back once', async () => {
      const { saleId, productId } = await sellAndAsk(3);
      const results = await Promise.allSettled([approve(saleId), approve(saleId, undefined, secondApprover)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect((failed.reason as { getResponse: () => { code: string } }).getResponse().code).toBe('CANCELLATION_NOT_PENDING');
      expect(await onHand(productId)).toBe(50);
      expect(await state.base.stockMovement.count({ where: { productId, type: 'SALE_CANCELLATION' } })).toBe(1);
      expect(await state.base.cashMovement.count({ where: { refId: saleId, type: 'REFUND' } })).toBe(1);
    });

    it('an approval and a rejection at once leave the sale in a state that matches the request', async () => {
      const { saleId, productId } = await sellAndAsk(1);
      const results = await Promise.allSettled([approve(saleId), reject(saleId, 'No procede')]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const [request] = await requests(saleId);
      const sale = await saleRow(saleId);
      if (request.status === 'APPROVED') {
        expect(sale.status).toBe('CANCELLED');
        expect(await onHand(productId)).toBe(50);
      } else {
        expect(request.status).toBe('REJECTED');
        expect(sale.status).toBe('COMPLETED');
        expect(await onHand(productId)).toBe(49);
      }
    });

    it('an approval and a withdrawal at once leave the sale in a state that matches the request', async () => {
      const { saleId, productId } = await sellAndAsk(1);
      const results = await Promise.allSettled([approve(saleId), svc().cancellations.withdraw(saleId)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const [request] = await requests(saleId);
      const sale = await saleRow(saleId);
      if (request.status === 'APPROVED') {
        expect(sale.status).toBe('CANCELLED');
        expect(await onHand(productId)).toBe(50);
      } else {
        expect(request.status).toBe('WITHDRAWN');
        expect(sale.status).toBe('COMPLETED');
        expect(await onHand(productId)).toBe(49);
      }
    });
  });

  describe('reject', () => {
    it('puts the sale back to COMPLETED with the reply and changes nothing else', async () => {
      const { saleId, productId } = await sellAndAsk(1);
      const before = await counts();
      expect(await reject(saleId, 'La factura ya fue entregada al cliente')).toEqual({ saleId, status: 'COMPLETED' });
      expect((await saleRow(saleId)).status).toBe('COMPLETED');
      expect((await saleRow(saleId)).invoice?.status).toBe('PENDING');
      const [request] = await requests(saleId);
      expect(request).toMatchObject({ status: 'REJECTED', decidedById: approver.userId, comment: 'La factura ya fue entregada al cliente' });
      expect(await counts()).toEqual(before);
      expect(await onHand(productId)).toBe(49);
    });

    it('needs a reply for the requester', async () => {
      const { saleId } = await sellAndAsk(1);
      expect(await codeOf(reject(saleId))).toBe('VALIDATION_FAILED');
      expect(await codeOf(reject(saleId, '   '))).toBe('VALIDATION_FAILED');
      expect((await saleRow(saleId)).status).toBe('CANCELLATION_PENDING');
    });

    it('writes one audit row and one outbox event for the requester', async () => {
      const { saleId } = await sellAndAsk(1);
      await reject(saleId, 'No procede');
      const [request] = await requests(saleId);
      expect(await audits(saleId, 'sales.sale.cancellation-reject')).toHaveLength(1);
      const published = (await events('sales.cancellation.rejected')).filter((e) => (e.payload as { saleId: string }).saleId === saleId);
      expect(published).toHaveLength(1);
      expect(published[0].payload).toMatchObject({ requestId: request.id, requestedById: state.cashier.userId, comment: 'No procede' });
    });

    it('lets the cashier ask again after a rejection, and the detail shows the reply meanwhile', async () => {
      const { saleId } = await sellAndAsk(1);
      await reject(saleId, 'No procede');
      const detail = await svc().history.detail(saleId);
      expect(detail.cancellation.lastDecision).toMatchObject({ status: 'REJECTED', decidedBy: 'User approver', comment: 'No procede' });
      expect(detail.cancellation.canRequest).toBe(true);
      await svc().cancellations.request(saleId, input);
      expect(await requests(saleId)).toHaveLength(2);
      expect((await svc().history.detail(saleId)).cancellation.lastDecision).toBeNull();
    });

    it('a second rejection is CANCELLATION_NOT_PENDING', async () => {
      const { saleId } = await sellAndAsk(1);
      await reject(saleId, 'No procede');
      expect(await codeOf(reject(saleId, 'Otra vez'))).toBe('CANCELLATION_NOT_PENDING');
    });
  });

  describe('what the detail says after approving', () => {
    it('shows the decision, the cancelled status and no way to ask again', async () => {
      const { saleId } = await sellAndAsk(1);
      await approve(saleId, 'Aprobado');
      const detail = await svc().history.detail(saleId);
      expect(detail.status).toBe('CANCELLED');
      expect(detail.invoice.status).toBe('CANCELLED');
      expect(detail.cancellation).toMatchObject({ canRequest: false, pending: null, lastDecision: { status: 'APPROVED', decidedBy: 'User approver', comment: 'Aprobado' } });
      const actions = detail.history.map((entry) => entry.action);
      expect(actions).toContain('sales.sale.cancellation-approve');
    });
  });

  describe('company isolation', () => {
    it("another company's approver cannot see or decide the request: 404", async () => {
      const { saleId } = await sellAndAsk(1);
      fx.useCompany(state.otherCompanyId);
      expect(await codeOf(svc(otherApprover).cancellations.review(saleId))).toBe('SALE_NOT_FOUND');
      expect(await codeOf(approve(saleId, undefined, otherApprover))).toBe('SALE_NOT_FOUND');
      expect(await codeOf(reject(saleId, 'x', otherApprover))).toBe('SALE_NOT_FOUND');
      fx.useCompany(state.companyId);
      expect((await saleRow(saleId)).status).toBe('CANCELLATION_PENDING');
    });
  });
});
