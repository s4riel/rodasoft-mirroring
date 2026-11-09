/**
 * Integration test of the returns of a sale (HU-VEN-21) against the real Postgres: the sale lookup, a return that goes to stock
 * and to scrap, the refund methods, the guards, the approval flow behind `sales.returnApprovalLimit`, the credit note and the
 * outbox event, idempotency, and the races a return has with another return, a decision, a cancellation request and a sale.
 */
import { randomUUID } from 'node:crypto';
import { codeOf, createPosFixture, detailsOf, type Caller } from '../pos/pos.int-fixture';

const fx = createPosFixture('salereturn');
const { state } = fx;

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Sale returns (integration, real Postgres)', () => {
  let approver: Caller;

  beforeAll(async () => {
    await fx.setup();
    approver = await fx.newMember('approver', state.companyId);
    fx.grant(approver, 'sales.history.view-all', 'sales.returns.approve');
  }, 60_000);
  afterAll(() => fx.teardown());
  beforeEach(() => fx.useCompany(state.companyId));

  afterEach(async () => {
    fx.useCompany(state.companyId);
    const where = { companyId: state.companyId };
    await state.base.creditNote.deleteMany({ where });
    await state.base.saleReturn.deleteMany({ where });
    await state.base.approvalRequest.deleteMany({ where });
    await state.base.invoice.deleteMany({ where });
    await state.base.sale.deleteMany({ where });
    await state.base.cashMovement.deleteMany({ where });
    await state.base.posCheckoutItem.deleteMany({ where });
    await state.base.posCheckout.deleteMany({ where });
    await state.base.outboxEvent.deleteMany({ where });
    await state.base.auditLog.deleteMany({ where });
    await state.base.companySetting.deleteMany({ where: { companyId: state.companyId, key: { in: ['sales.returnApprovalLimit', 'sales.returnWindowDays'] } } });
    await state.base.cashShift.updateMany({ where: { companyId: state.companyId, status: 'CLOSED' }, data: { status: 'OPEN' } });
    await state.base.warehouse.update({ where: { id: state.centralId }, data: { status: 'ACTIVE' } });
  });

  const svc = (caller: Caller = state.cashier) => fx.as(caller);
  const setSetting = (key: string, value: unknown) =>
    state.base.companySetting.upsert({
      where: { companyId_key: { companyId: state.companyId, key } },
      create: { companyId: state.companyId, key, value: value as never },
      update: { value: value as never },
    });

  interface Sold {
    saleId: string;
    number: string;
    /** sale items in the order they were added */
    items: { id: string; productId: string; quantity: number }[];
  }

  /** Sells `quantities.length` fresh products (100.00 each, stock 50) in cash and returns the sale with its lines. */
  async function sell(quantities: number[] = [2, 1], caller: Caller = state.cashier): Promise<Sold> {
    for (const quantity of quantities) {
      const product = await fx.newProduct({ price: '100.00', stock: { [state.centralId]: 50 } });
      await svc(caller).checkout.addItem({ productId: product.id, quantity });
    }
    const { total } = await svc(caller).payment.pay();
    const done = await svc(caller).payment.complete({
      payments: [{ method: 'CASH', received: total }],
      expectedTotal: total,
      idempotencyKey: randomUUID(),
    });
    const sale = await state.base.sale.findUniqueOrThrow({
      where: { id: done.sale.saleId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    return {
      saleId: sale.id,
      number: sale.number,
      items: sale.items.map((item) => ({ id: item.id, productId: item.productId, quantity: item.quantity })),
    };
  }

  const make = (sold: Sold, lines: { item: number; quantity: number; condition?: 'RESTOCK' | 'SCRAP' }[], extra: Record<string, unknown> = {}) => ({
    saleId: sold.saleId,
    reason: 'FACTORY_DEFECT',
    refundMethod: 'CASH',
    items: lines.map((line) => ({ saleItemId: sold.items[line.item].id, quantity: line.quantity, condition: line.condition ?? 'RESTOCK' })),
    ...extra,
  });
  const create = (input: ReturnType<typeof make>, caller: Caller = state.cashier, key: string = randomUUID()) => svc(caller).returns.create(input as never, key);

  const stockMovements = (productId: string) => state.base.stockMovement.findMany({ where: { productId, type: 'RETURN' } });
  const stockLevel = async (productId: string) =>
    (await state.base.stockLevel.findUniqueOrThrow({ where: { productId_warehouseId: { productId, warehouseId: state.centralId } } })).quantity;
  const refunds = () => state.base.cashMovement.findMany({ where: { companyId: state.companyId, type: 'REFUND' } });
  const events = (type: string) => state.base.outboxEvent.findMany({ where: { companyId: state.companyId, type } });
  const returnsOf = (saleId: string) => state.base.saleReturn.findMany({ where: { saleId }, orderBy: { createdAt: 'asc' } });
  const counts = async () => ({
    returns: await state.base.saleReturn.count({ where: { companyId: state.companyId } }),
    stock: await state.base.stockMovement.count({ where: { companyId: state.companyId } }),
    cash: await state.base.cashMovement.count({ where: { companyId: state.companyId } }),
    notes: await state.base.creditNote.count({ where: { companyId: state.companyId } }),
  });

  describe('sale lookup', () => {
    it('finds a sale by number, with sold, returned and returnable per line', async () => {
      const sold = await sell([2, 1]);
      const found = await svc().returnQueries.lookup(sold.number);
      expect(found).toMatchObject({ saleId: sold.saleId, saleNumber: sold.number, total: '300.00', hasCustomer: false, windowEndsAt: null });
      expect(found.lines.map((l) => [l.sold, l.returned, l.returnable])).toEqual([
        [2, 0, 2],
        [1, 0, 1],
      ]);
    });

    it('finds it by its sequence digits, counts earlier returns and ignores rejected ones', async () => {
      const sold = await sell([3]);
      await create(make(sold, [{ item: 0, quantity: 1 }]));
      const found = await svc().returnQueries.lookup(String(Number(sold.number.slice(2))));
      expect(found.saleId).toBe(sold.saleId);
      expect(found.lines[0]).toMatchObject({ sold: 3, returned: 1, returnable: 2 });
    });

    it('answers SALE_NOT_FOUND for an unknown number and for the sale of another company', async () => {
      const sold = await sell([1]);
      expect(await codeOf(svc().returnQueries.lookup('V-999999'))).toBe('SALE_NOT_FOUND');
      fx.useCompany(state.otherCompanyId);
      expect(await codeOf(svc(state.other).returnQueries.lookup(sold.number))).toBe('SALE_NOT_FOUND');
    });
  });

  describe('create', () => {
    it('returns 2 of 3 pieces, one to stock and one to scrap: DEV-, items, one RETURN movement, refund, credit note, audit and event', async () => {
      const sold = await sell([2, 1]);
      const detail = await create(make(sold, [{ item: 0, quantity: 1 }, { item: 0, quantity: 1, condition: 'SCRAP' }], { comment: ' se rompió ' }));

      expect(detail).toMatchObject({ status: 'APPROVED', total: '200.00', pieces: 2, scrapPieces: 1, refundMethod: 'CASH', reason: 'FACTORY_DEFECT', comment: 'se rompió', creditNoteStatus: 'PENDING' });
      expect(detail.number).toMatch(/^DEV-\d{6}$/);
      expect(detail.items.map((i) => [i.quantity, i.condition, i.refundAmount])).toEqual([
        [1, 'RESTOCK', '100.00'],
        [1, 'SCRAP', '100.00'],
      ]);

      // one movement for the stock line, none for the scrap line
      const movements = await stockMovements(sold.items[0].productId);
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({ quantity: 1, refType: 'SALE_RETURN', refNumber: detail.number, warehouseId: state.centralId });
      expect(await stockLevel(sold.items[0].productId)).toBe(50 - 2 + 1);
      expect(movements[0].balanceAfter).toBe(50 - 2 + 1);

      const [refund] = await refunds();
      expect(refund).toMatchObject({ amount: expect.anything(), refType: 'SALE_RETURN', refId: detail.id, userId: state.cashier.userId });
      expect(refund.amount.toFixed(2)).toBe('200.00');

      const note = await state.base.creditNote.findUniqueOrThrow({ where: { returnId: detail.id } });
      const invoice = await state.base.invoice.findUniqueOrThrow({ where: { saleId: sold.saleId } });
      expect(note).toMatchObject({ status: 'PENDING', invoiceId: invoice.id, customerTaxName: invoice.customerTaxName });
      expect(note.total.toFixed(2)).toBe('200.00');

      expect(await state.base.auditLog.count({ where: { entity: 'SaleReturn', entityId: detail.id, action: 'sales.return.create' } })).toBe(1);
      const [event] = await events('sales.return.completed');
      expect(event.payload).toMatchObject({ returnId: detail.id, creditNoteId: note.id, invoiceId: invoice.id, saleId: sold.saleId });
    });

    it('works for an ORDER sale (no checkout, no shift), refunding to a transfer', async () => {
      const sold = await sell([2]);
      await state.base.sale.update({ where: { id: sold.saleId }, data: { origin: 'ORDER', checkoutId: null, shiftId: null } });
      const detail = await create(make(sold, [{ item: 0, quantity: 2 }], { refundMethod: 'TRANSFER', refundReference: 'TR-77' }));
      expect(detail).toMatchObject({ refundMethod: 'TRANSFER', refundReference: 'TR-77', total: '200.00' });
      expect(await stockLevel(sold.items[0].productId)).toBe(50);
    });

    it('keeps the discount: the refund is the share of what the customer paid, and all returns add up to the sale total', async () => {
      const sold = await sell([3]);
      // 10 % off: the sale total is 270.00
      await state.base.sale.update({ where: { id: sold.saleId }, data: { discountType: 'PERCENT', discountValue: '10.00', discountAmount: '30.00', total: '270.00' } });
      const first = await create(make(sold, [{ item: 0, quantity: 1 }]));
      const second = await create(make(sold, [{ item: 0, quantity: 1 }]));
      const last = await create(make(sold, [{ item: 0, quantity: 1 }]));
      expect([first.total, second.total, last.total]).toEqual(['90.00', '90.00', '90.00']);
    });

    it('a transfer and a store credit write no cash movement; store credit needs the customer', async () => {
      const sold = await sell([2]);
      expect(await codeOf(create(make(sold, [{ item: 0, quantity: 1 }], { refundMethod: 'STORE_CREDIT' })))).toBe('STORE_CREDIT_NEEDS_CUSTOMER');
      const customer = await state.base.customer.create({ data: { companyId: state.companyId, name: 'Taller Sur', documentType: 1, documentNumber: '1020304050' } });
      await state.base.sale.update({ where: { id: sold.saleId }, data: { customerId: customer.id } });
      await create(make(sold, [{ item: 0, quantity: 1 }], { refundMethod: 'STORE_CREDIT' }));
      await create(make(sold, [{ item: 0, quantity: 1 }], { refundMethod: 'TRANSFER', refundReference: 'TR-1' }));
      expect(await refunds()).toHaveLength(0);
      expect(await state.base.creditNote.count({ where: { companyId: state.companyId } })).toBe(2);
    });
  });

  describe('schema checks', () => {
    it('the database refuses a negative total, a negative refund and a zero quantity', async () => {
      const sold = await sell([2]);
      const created = await create(make(sold, [{ item: 0, quantity: 1 }]));
      const item = await state.base.saleReturnItem.findFirstOrThrow({ where: { returnId: created.id } });
      await expect(state.base.saleReturn.update({ where: { id: created.id }, data: { total: '-0.01' } })).rejects.toThrow();
      await expect(state.base.saleReturnItem.update({ where: { id: item.id }, data: { refundAmount: '-0.01' } })).rejects.toThrow();
      await expect(state.base.saleReturnItem.update({ where: { id: item.id }, data: { quantity: 0 } })).rejects.toThrow();
    });
  });

  describe('guards', () => {
    it('refuses an empty return, an unknown line and a bad transfer or reason', async () => {
      const sold = await sell([1]);
      expect(await codeOf(create(make(sold, [{ item: 0, quantity: 0 }])))).toBe('RETURN_EMPTY');
      expect(await codeOf(create({ ...make(sold, [{ item: 0, quantity: 1 }]), items: [{ saleItemId: randomUUID(), quantity: 1, condition: 'RESTOCK' }] } as never))).toBe('SALE_ITEM_NOT_FOUND');
      expect(await codeOf(create(make(sold, [{ item: 0, quantity: 1 }], { refundMethod: 'TRANSFER' })))).toBe('VALIDATION_FAILED');
      expect(await codeOf(create(make(sold, [{ item: 0, quantity: 1 }], { reason: 'NOPE' })))).toBe('VALIDATION_FAILED');
    });

    it('refuses more than was sold, also summing earlier returns, with the detail per line', async () => {
      const sold = await sell([2]);
      await create(make(sold, [{ item: 0, quantity: 1 }]));
      const before = await counts();
      const input = make(sold, [{ item: 0, quantity: 2 }]);
      expect(await codeOf(create(input))).toBe('RETURN_EXCEEDS_SOLD');
      expect(await detailsOf(create(input))).toEqual({ items: [{ saleItemId: sold.items[0].id, requested: 2, returnable: 1 }] });
      expect(await counts()).toEqual(before);
    });

    it('refuses a cancelled or cancellation-pending sale', async () => {
      const sold = await sell([1]);
      await state.base.sale.update({ where: { id: sold.saleId }, data: { status: 'CANCELLATION_PENDING' } });
      expect(await codeOf(create(make(sold, [{ item: 0, quantity: 1 }])))).toBe('SALE_NOT_RETURNABLE');
      await state.base.sale.update({ where: { id: sold.saleId }, data: { status: 'CANCELLED' } });
      expect(await codeOf(create(make(sold, [{ item: 0, quantity: 1 }])))).toBe('SALE_NOT_RETURNABLE');
    });

    it('refuses a sale past the return window', async () => {
      const sold = await sell([1]);
      await setSetting('sales.returnWindowDays', 7);
      await state.base.sale.update({ where: { id: sold.saleId }, data: { createdAt: new Date(Date.now() - 20 * DAY_MS) } });
      expect(await codeOf(create(make(sold, [{ item: 0, quantity: 1 }])))).toBe('RETURN_WINDOW_EXPIRED');
    });

    it('a cash refund needs an open shift of the caller', async () => {
      const sold = await sell([1]);
      expect(await codeOf(create(make(sold, [{ item: 0, quantity: 1 }]), state.noShift))).toBe('CASH_SHIFT_NOT_OPEN');
      expect(await returnsOf(sold.saleId)).toHaveLength(0);
    });

    it('a sale of another company does not exist', async () => {
      const sold = await sell([1]);
      fx.useCompany(state.otherCompanyId);
      expect(await codeOf(create(make(sold, [{ item: 0, quantity: 1 }], { refundMethod: 'TRANSFER', refundReference: 'x' }), state.other))).toBe('SALE_NOT_FOUND');
    });

    it('rolls everything back when the warehouse cannot take the piece back', async () => {
      const sold = await sell([1]);
      const before = await counts();
      await state.base.warehouse.update({ where: { id: state.centralId }, data: { status: 'INACTIVE' } });
      expect(await codeOf(create(make(sold, [{ item: 0, quantity: 1 }])))).toBe('WAREHOUSE_INACTIVE');
      expect(await counts()).toEqual(before);
    });

    it('a sale with a return can no longer be cancelled', async () => {
      const sold = await sell([2]);
      await create(make(sold, [{ item: 0, quantity: 1 }]));
      expect(await codeOf(svc().cancellations.request(sold.saleId, { reason: 'OTHER', comment: 'x' }))).toBe('SALE_HAS_RETURNS');
    });
  });

  describe('approval behind sales.returnApprovalLimit', () => {
    it('asks for approval above the limit and writes nothing else until a decision', async () => {
      const sold = await sell([3]);
      await setSetting('sales.returnApprovalLimit', '100.00');
      const before = await counts();
      const detail = await create(make(sold, [{ item: 0, quantity: 2 }]));

      expect(detail).toMatchObject({ status: 'PENDING_APPROVAL', total: '200.00', creditNoteStatus: null });
      expect(detail.approval).not.toBeNull();
      expect(await counts()).toEqual({ ...before, returns: before.returns + 1 });
      const request = await state.base.approvalRequest.findFirstOrThrow({ where: { subjectId: detail.id } });
      expect(request).toMatchObject({ type: 'RETURN', status: 'PENDING', reason: 'FACTORY_DEFECT' });
      expect(await events('sales.return.requested')).toHaveLength(1);
      expect(await events('sales.return.completed')).toHaveLength(0);
    });

    it('does not ask when the return is at the limit or the limit is null', async () => {
      const sold = await sell([3]);
      await setSetting('sales.returnApprovalLimit', '100.00');
      expect((await create(make(sold, [{ item: 0, quantity: 1 }]))).status).toBe('APPROVED');
      await state.base.companySetting.deleteMany({ where: { companyId: state.companyId, key: 'sales.returnApprovalLimit' } });
      expect((await create(make(sold, [{ item: 0, quantity: 2 }]))).status).toBe('APPROVED');
    });

    it('approving does everything in one go, with the cash leaving the shift of the requesting register', async () => {
      const sold = await sell([2]);
      await setSetting('sales.returnApprovalLimit', '50.00');
      const pending = await create(make(sold, [{ item: 0, quantity: 2 }]));

      const approved = await svc(approver).returns.approve(pending.id, { comment: 'Ok' });
      expect(approved).toMatchObject({ status: 'APPROVED', creditNoteStatus: 'PENDING', decision: { status: 'APPROVED', comment: 'Ok' } });
      expect(await stockLevel(sold.items[0].productId)).toBe(50);
      const [refund] = await refunds();
      const shift = await state.base.cashShift.findUniqueOrThrow({ where: { id: refund.shiftId } });
      expect(shift.openedById).toBe(state.cashier.userId);
      expect(refund.userId).toBe(approver.userId);
      expect(await events('sales.return.completed')).toHaveLength(1);
    });

    it('rejecting needs a reply and writes nothing else', async () => {
      const sold = await sell([2]);
      await setSetting('sales.returnApprovalLimit', '50.00');
      const pending = await create(make(sold, [{ item: 0, quantity: 2 }]));
      expect(await codeOf(svc(approver).returns.reject(pending.id, { comment: '  ' }))).toBe('VALIDATION_FAILED');
      const before = await counts();
      const rejected = await svc(approver).returns.reject(pending.id, { comment: 'Fuera de garantía' });
      expect(rejected).toMatchObject({ status: 'REJECTED', decision: { status: 'REJECTED', comment: 'Fuera de garantía' } });
      expect(await counts()).toEqual(before);
      // a rejected return frees its pieces
      expect((await svc().returnQueries.lookup(sold.number)).lines[0].returnable).toBe(2);
    });

    it('is decided once: a second approve or a reject afterwards is RETURN_NOT_PENDING', async () => {
      const sold = await sell([2]);
      await setSetting('sales.returnApprovalLimit', '50.00');
      const pending = await create(make(sold, [{ item: 0, quantity: 1 }]));
      await svc(approver).returns.approve(pending.id, {});
      expect(await codeOf(svc(approver).returns.approve(pending.id, {}))).toBe('RETURN_NOT_PENDING');
      expect(await codeOf(svc(approver).returns.reject(pending.id, { comment: 'x' }))).toBe('RETURN_NOT_PENDING');
      expect(await stockMovements(sold.items[0].productId)).toHaveLength(1);
    });

    it('approving a cash return when the register has no open shift is CASH_SHIFT_NOT_OPEN_FOR_REFUND and leaves it pending', async () => {
      const sold = await sell([2]);
      await setSetting('sales.returnApprovalLimit', '50.00');
      const pending = await create(make(sold, [{ item: 0, quantity: 2 }]));
      await state.base.cashShift.updateMany({ where: { companyId: state.companyId, openedById: state.cashier.userId }, data: { status: 'CLOSED' } });
      expect(await codeOf(svc(approver).returns.approve(pending.id, {}))).toBe('CASH_SHIFT_NOT_OPEN_FOR_REFUND');
      expect((await returnsOf(sold.saleId))[0].status).toBe('PENDING_APPROVAL');
      expect(await stockMovements(sold.items[0].productId)).toHaveLength(0);
    });

    it('a return of another company does not exist', async () => {
      const sold = await sell([2]);
      await setSetting('sales.returnApprovalLimit', '50.00');
      const pending = await create(make(sold, [{ item: 0, quantity: 2 }]));
      fx.useCompany(state.otherCompanyId);
      expect(await codeOf(svc(state.other).returnQueries.detail(pending.id))).toBe('RETURN_NOT_FOUND');
    });
  });

  describe('idempotency', () => {
    it('a repeated Idempotency-Key returns the first return and writes nothing more', async () => {
      const sold = await sell([2]);
      const key = randomUUID();
      const first = await create(make(sold, [{ item: 0, quantity: 1 }]), state.cashier, key);
      const again = await create(make(sold, [{ item: 0, quantity: 1 }]), state.cashier, key);
      expect(again.id).toBe(first.id);
      expect(await returnsOf(sold.saleId)).toHaveLength(1);
      expect(await stockMovements(sold.items[0].productId)).toHaveLength(1);
      expect(await refunds()).toHaveLength(1);
    });

    it('a key used for another sale is RETURN_KEY_REUSED', async () => {
      const a = await sell([1]);
      const b = await sell([1]);
      const key = randomUUID();
      await create(make(a, [{ item: 0, quantity: 1 }]), state.cashier, key);
      expect(await codeOf(create(make(b, [{ item: 0, quantity: 1 }]), state.cashier, key))).toBe('RETURN_KEY_REUSED');
    });
  });

  describe('concurrency', () => {
    it('two returns of the last returnable piece: one wins and the stock goes up once', async () => {
      const sold = await sell([1]);
      const results = await Promise.allSettled([create(make(sold, [{ item: 0, quantity: 1 }])), create(make(sold, [{ item: 0, quantity: 1 }]))]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect((failed.reason as { getResponse: () => { code: string } }).getResponse().code).toBe('RETURN_EXCEEDS_SOLD');
      expect(await stockMovements(sold.items[0].productId)).toHaveLength(1);
      expect(await stockLevel(sold.items[0].productId)).toBe(50);
    });

    it('two approvals of one return: one wins', async () => {
      const sold = await sell([2]);
      await setSetting('sales.returnApprovalLimit', '50.00');
      const pending = await create(make(sold, [{ item: 0, quantity: 2 }]));
      const results = await Promise.allSettled([svc(approver).returns.approve(pending.id, {}), svc(approver).returns.approve(pending.id, {})]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await stockMovements(sold.items[0].productId)).toHaveLength(1);
      expect(await refunds()).toHaveLength(1);
    });

    it('approve against reject: one wins and the other is RETURN_NOT_PENDING', async () => {
      const sold = await sell([2]);
      await setSetting('sales.returnApprovalLimit', '50.00');
      const pending = await create(make(sold, [{ item: 0, quantity: 2 }]));
      const results = await Promise.allSettled([svc(approver).returns.approve(pending.id, {}), svc(approver).returns.reject(pending.id, { comment: 'No' })]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const status = (await returnsOf(sold.saleId))[0].status;
      expect(await stockMovements(sold.items[0].productId)).toHaveLength(status === 'APPROVED' ? 1 : 0);
    });

    it('a return against a cancellation request of the same sale: never both', async () => {
      const sold = await sell([2]);
      const results = await Promise.allSettled([
        create(make(sold, [{ item: 0, quantity: 1 }])),
        svc().cancellations.request(sold.saleId, { reason: 'OTHER', comment: 'x' }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const sale = await state.base.sale.findUniqueOrThrow({ where: { id: sold.saleId } });
      const returns = await returnsOf(sold.saleId);
      expect(sale.status === 'CANCELLATION_PENDING' ? returns.length : -returns.length).toBeLessThanOrEqual(0);
    });

    it('a return and a POS sale of the same product do not deadlock', async () => {
      const sold = await sell([2]);
      const productId = sold.items[0].productId;
      const sellAgain = async () => {
        await svc(state.second).checkout.addItem({ productId, quantity: 1 });
        const { total } = await svc(state.second).payment.pay();
        return svc(state.second).payment.complete({ payments: [{ method: 'CASH', received: total }], expectedTotal: total, idempotencyKey: randomUUID() });
      };
      const results = await Promise.all([create(make(sold, [{ item: 0, quantity: 1 }])), sellAgain()]);
      expect(results).toHaveLength(2);
      expect(await stockLevel(productId)).toBe(50 - 2 + 1 - 1);
    });
  });

  describe('list and detail', () => {
    it('lists newest first with the KPIs of the month, the pending ones and the scrap pieces', async () => {
      const sold = await sell([3]);
      await create(make(sold, [{ item: 0, quantity: 1 }, { item: 0, quantity: 1, condition: 'SCRAP' }]));
      await setSetting('sales.returnApprovalLimit', '50.00');
      await create(make(sold, [{ item: 0, quantity: 1 }], { refundMethod: 'TRANSFER', refundReference: 'T' }));

      const list = await svc().returnQueries.list({});
      expect(list.total).toBe(2);
      expect(list.items[0].status).toBe('PENDING_APPROVAL');
      expect(list.kpis).toEqual({ monthCount: 1, monthAmount: '200.00', pendingCount: 1, scrapPieces: 1 });
      expect(list.totalAmount).toBe('300.00');
      expect((await svc().returnQueries.list({ status: 'PENDING_APPROVAL' })).items).toHaveLength(1);
    });

    it('the detail has the timeline, the audit and the sale refs', async () => {
      const sold = await sell([2]);
      const created = await create(make(sold, [{ item: 0, quantity: 1 }]));
      const detail = await svc().returnQueries.detail(created.id);
      expect(detail.timeline.map((s) => s.state)).toEqual(['done', 'done', 'current', 'done']);
      expect(detail.audit.map((a) => a.action)).toEqual(['sales.return.create']);
      const refs = await svc().returnQueries.refsOfSale(sold.saleId);
      expect(refs).toEqual([expect.objectContaining({ id: created.id, status: 'APPROVED', total: '100.00' })]);
      const sale = await svc(approver).history.detail(sold.saleId);
      expect(sale.returnable).toBe(true);
      expect(sale.returns).toHaveLength(1);
    });
  });
});
