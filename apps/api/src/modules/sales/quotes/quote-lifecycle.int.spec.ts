/**
 * Integration test of sending, following and renewing quotes (HU-VEN-17, HU-VEN-18) against the real Postgres: the send log,
 * the e-mail in the outbox, the status moves through the machine, expiry as shown on read, renewal with fresh prices, rejection,
 * the timeline of the detail, concurrency and tenant isolation.
 */
import { codeOf, createPosFixture } from '../pos/pos.int-fixture';

const fx = createPosFixture('quote-life');
const { state } = fx;

describe('Quote lifecycle (integration, real Postgres)', () => {
  beforeAll(() => fx.setup(), 60_000);
  afterAll(() => fx.teardown());
  beforeEach(() => fx.useCompany(state.companyId));
  afterEach(async () => {
    fx.useCompany(state.companyId);
    await state.base.quote.deleteMany({ where: { companyId: state.companyId } });
    await state.base.customer.deleteMany({ where: { companyId: state.companyId } });
    await state.base.documentSequence.deleteMany({ where: { companyId: state.companyId } });
    await state.base.companySetting.deleteMany({ where: { companyId: state.companyId } });
    await state.base.auditLog.deleteMany({ where: { companyId: state.companyId } });
    await state.base.outboxEvent.deleteMany({ where: { companyId: state.companyId } });
  });

  const quotes = () => fx.as(state.cashier).quotes;
  const life = () => fx.as(state.cashier).quoteLifecycle;
  let docSeq = 0;
  const customer = (opts: { discountType?: 'NONE' | 'PERCENT'; discountValue?: string } = {}) => {
    docSeq += 1;
    return state.base.customer.create({
      data: {
        companyId: state.companyId,
        name: 'Minera Demo',
        documentType: 1,
        documentNumber: `${2000000 + docSeq}`,
        email: 'minera@demo.test',
        phone: '70000000',
        discountType: opts.discountType ?? 'NONE',
        discountValue: opts.discountValue ?? '0',
      },
    });
  };
  const todayPlus = (days: number) => new Date(Date.now() - 4 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);
  const draft = async (price = '100.00', opts: Parameters<typeof customer>[0] = {}) => {
    const c = await customer(opts);
    const p = await fx.newProduct({ price, code: `LIFE-${docSeq}` });
    const quote = await quotes().create({ customerId: c.id, lines: [{ productId: p.id, quantity: 2 }] });
    return { quote, product: p, customer: c };
  };
  /** Moves the validity into the past, as if the days went by. */
  const age = (id: string, status: 'DRAFT' | 'SENT' | 'EXPIRED', daysAgo = 2) =>
    state.base.quote.update({ where: { id }, data: { status, validUntil: new Date(`${todayPlus(-daysAgo)}T00:00:00Z`) } });

  describe('send', () => {
    it('sends a draft by e-mail: SENT, logged, queued in the outbox and audited in the same transaction', async () => {
      const { quote } = await draft();
      const sent = await life().send(quote.id, { channel: 'EMAIL', to: ' cliente@demo.test ', message: 'Hola Ana' });
      expect(sent.status).toBe('SENT');
      expect(sent.sendLog).toMatchObject([{ channel: 'EMAIL', to: 'cliente@demo.test', userName: 'User cashier' }]);
      expect(sent.timeline.map((s) => [s.key, s.state])).toEqual([['DRAFT', 'done'], ['SENT', 'done'], ['WAITING', 'current'], ['CONVERTED', 'pending']]);

      const events = await state.base.outboxEvent.findMany({ where: { companyId: state.companyId, type: 'sales.quote-email' } });
      expect(events).toHaveLength(1);
      const payload = events[0].payload as { email: string; number: string; text: string };
      expect(payload.email).toBe('cliente@demo.test');
      expect(payload.text).toContain('Hola Ana');
      expect(payload.text).toContain(quote.number);
      expect(payload.text).toContain('Total: Bs 200,00');
      expect(payload.text).not.toContain(String((await state.base.customer.findFirstOrThrow({ where: { id: quote.customer.id } })).documentNumber));
      const audit = await state.base.auditLog.findMany({ where: { entity: 'Quote', entityId: quote.id, action: 'sales.quote.send' } });
      expect(audit).toHaveLength(1);
    });

    it('records WhatsApp with the country code and the PDF without a recipient, and keeps SENT on a re-send', async () => {
      const { quote } = await draft();
      await life().send(quote.id, { channel: 'WHATSAPP', to: '7 000 0000' });
      const again = await life().send(quote.id, { channel: 'PDF' });
      expect(again.status).toBe('SENT');
      expect(again.sendLog.map((e) => [e.channel, e.to])).toEqual([['WHATSAPP', '59170000000'], ['PDF', null]]);
      expect(await state.base.outboxEvent.count({ where: { companyId: state.companyId, type: 'sales.quote-email' } })).toBe(0);
    });

    it('refuses a bad recipient, an expired quote and a closed one', async () => {
      const { quote } = await draft();
      expect(await codeOf(life().send(quote.id, { channel: 'EMAIL', to: 'nope' }))).toBe('INVALID_EMAIL');
      expect(await codeOf(life().send(quote.id, { channel: 'EMAIL' }))).toBe('INVALID_EMAIL');
      expect(await codeOf(life().send(quote.id, { channel: 'WHATSAPP', to: '123' }))).toBe('QUOTE_PHONE_INVALID');
      expect((await quotes().detail(quote.id)).sendLog).toHaveLength(0);

      await age(quote.id, 'DRAFT');
      expect(await codeOf(life().send(quote.id, { channel: 'PDF' }))).toBe('QUOTE_DRAFT_EXPIRED');
      await age(quote.id, 'SENT');
      expect(await codeOf(life().send(quote.id, { channel: 'PDF' }))).toBe('QUOTE_EXPIRED');
      await state.base.quote.update({ where: { id: quote.id }, data: { status: 'REJECTED' } });
      expect(await codeOf(life().send(quote.id, { channel: 'PDF' }))).toBe('QUOTE_INVALID_TRANSITION');
    });

    it('two simultaneous sends of a draft move it to SENT once and log both', async () => {
      const { quote } = await draft();
      await Promise.all([life().send(quote.id, { channel: 'PDF' }), life().send(quote.id, { channel: 'PDF' })]);
      const detail = await quotes().detail(quote.id);
      expect(detail.status).toBe('SENT');
      expect(detail.sendLog).toHaveLength(2);
    });
  });

  describe('expiry as shown, and renewal', () => {
    it('a sent quote past its day reads as expired with a warning timeline and offers renew and reject', async () => {
      const { quote } = await draft();
      await life().send(quote.id, { channel: 'PDF' });
      await age(quote.id, 'SENT', 1);
      const detail = await quotes().detail(quote.id);
      expect(detail.status).toBe('EXPIRED');
      expect(detail.timeline[2]).toMatchObject({ key: 'EXPIRED', state: 'warning', date: todayPlus(-1) });
      expect([detail.canRenew, detail.canReject, detail.canSend, detail.convertible]).toEqual([true, true, false, false]);
    });

    it('renews with today’s prices, the customer’s current discount and a new validity, auditing both steps', async () => {
      const { quote, product, customer: c } = await draft('100.00');
      await life().send(quote.id, { channel: 'PDF' });
      await age(quote.id, 'SENT'); // still SENT in the table: the job has not run
      await state.base.product.update({ where: { id: product.id }, data: { salePrice: '120.00' } });
      await state.base.customer.update({ where: { id: c.id }, data: { discountType: 'PERCENT', discountValue: '10.00' } });

      const renewed = await life().renew(quote.id, {});
      expect(renewed.status).toBe('SENT');
      expect(renewed.validUntil).toBe(todayPlus(7));
      expect(renewed.lines[0]).toMatchObject({ unitPrice: '120.00', lineTotal: '240.00' });
      expect(renewed.subtotal).toBe('240.00');
      expect(renewed.discountAmount).toBe('24.00');
      expect(renewed.total).toBe('216.00');
      expect(renewed.convertible).toBe(true);

      const actions = (await state.base.auditLog.findMany({ where: { entity: 'Quote', entityId: quote.id }, orderBy: { id: 'asc' } })).map((a) => a.action);
      expect(actions).toEqual(['sales.quote.create', 'sales.quote.send', 'sales.quote.expire', 'sales.quote.renew']);
      const renew = await state.base.auditLog.findFirstOrThrow({ where: { entityId: quote.id, action: 'sales.quote.renew' } });
      expect(renew.before).toMatchObject({ status: 'EXPIRED', total: '200.00' });
      expect(renew.after).toMatchObject({ status: 'SENT', total: '216.00' });
    });

    it('renews a quote the job already expired, to a typed day, and refuses a past day', async () => {
      const { quote } = await draft();
      await age(quote.id, 'EXPIRED');
      expect(await codeOf(life().renew(quote.id, { validUntil: todayPlus(-1) }))).toBe('QUOTE_VALIDITY_IN_PAST');
      expect((await quotes().detail(quote.id)).status).toBe('EXPIRED');
      const renewed = await life().renew(quote.id, { validUntil: todayPlus(30) });
      expect(renewed.validUntil).toBe(todayPlus(30));
      expect(renewed.status).toBe('SENT');
    });

    it('uses sales.quoteValidityDays for the new validity', async () => {
      const { quote } = await draft();
      await age(quote.id, 'EXPIRED');
      await state.base.companySetting.create({ data: { companyId: state.companyId, key: 'sales.quoteValidityDays', value: 15 } });
      expect((await life().renew(quote.id, {})).validUntil).toBe(todayPlus(15));
    });

    it('does not renew a valid, closed or draft quote, nor one with an inactive product', async () => {
      const { quote, product } = await draft();
      expect(await codeOf(life().renew(quote.id, {}))).toBe('QUOTE_INVALID_TRANSITION');
      await life().send(quote.id, { channel: 'PDF' });
      expect(await codeOf(life().renew(quote.id, {}))).toBe('QUOTE_INVALID_TRANSITION');
      await age(quote.id, 'SENT');
      await state.base.product.update({ where: { id: product.id }, data: { status: 'INACTIVE' } });
      expect(await codeOf(life().renew(quote.id, {}))).toBe('PRODUCT_INACTIVE');
      // nothing changed: the failed renewal rolled back, including the expire step
      expect((await state.base.quote.findFirstOrThrow({ where: { id: quote.id } })).status).toBe('SENT');
      expect(await state.base.auditLog.count({ where: { entityId: quote.id, action: 'sales.quote.expire' } })).toBe(0);
    });

    it('two simultaneous renewals renew once', async () => {
      const { quote } = await draft();
      await age(quote.id, 'EXPIRED');
      const results = await Promise.allSettled([life().renew(quote.id, {}), life().renew(quote.id, {})]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await state.base.auditLog.count({ where: { entityId: quote.id, action: 'sales.quote.renew' } })).toBe(1);
    });
  });

  describe('reject', () => {
    it('rejects a sent and an expired quote, and shows the rejected timeline', async () => {
      const a = await draft();
      await life().send(a.quote.id, { channel: 'PDF' });
      const rejected = await life().reject(a.quote.id);
      expect(rejected.status).toBe('REJECTED');
      expect(rejected.timeline[2]).toMatchObject({ key: 'REJECTED', state: 'warning', date: todayPlus(0) });
      expect([rejected.canSend, rejected.canRenew, rejected.canReject]).toEqual([false, false, false]);

      const b = await draft();
      await age(b.quote.id, 'EXPIRED');
      expect((await life().reject(b.quote.id)).status).toBe('REJECTED');
      expect(await state.base.auditLog.count({ where: { action: 'sales.quote.reject', entity: 'Quote' } })).toBe(2);
    });

    it('rejecting a sent quote whose day passed audits the expiry first and keeps the day it was rejected', async () => {
      const { quote } = await draft();
      await life().send(quote.id, { channel: 'PDF' });
      await age(quote.id, 'SENT');
      const rejected = await life().reject(quote.id);
      const actions = (await state.base.auditLog.findMany({ where: { entityId: quote.id }, orderBy: { id: 'asc' } })).map((a) => a.action);
      expect(actions).toEqual(['sales.quote.create', 'sales.quote.send', 'sales.quote.expire', 'sales.quote.reject']);
      // a later write to the row does not move the day shown
      await state.base.quote.update({ where: { id: quote.id }, data: { updatedAt: new Date('2020-01-01T00:00:00Z') } });
      expect((await quotes().detail(quote.id)).timeline[2].date).toBe(rejected.timeline[2].date);
    });

    it('refuses to reject a draft or a rejected quote', async () => {
      const { quote } = await draft();
      expect(await codeOf(life().reject(quote.id))).toBe('QUOTE_INVALID_TRANSITION');
      await life().send(quote.id, { channel: 'PDF' });
      await life().reject(quote.id);
      expect(await codeOf(life().reject(quote.id))).toBe('QUOTE_INVALID_TRANSITION');
    });
  });

  describe('detail', () => {
    it('shows the available stock of the main warehouse and the customer contact, and never a cost', async () => {
      const { quote, product } = await draft();
      const withStock = await fx.newProduct({ price: '10.00', code: 'LIFE-STOCK', stock: { [state.centralId]: 9 }, reserved: { [state.centralId]: 4 } });
      const c = await customer();
      const q = await quotes().create({ customerId: c.id, lines: [{ productId: withStock.id, quantity: 1 }, { productId: product.id, quantity: 1 }] });
      const detail = await quotes().detail(q.id);
      expect(detail.customerEmail).toBe('minera@demo.test');
      expect(detail.customerPhone).toBe('70000000');
      expect(detail.company).toBeTruthy();
      expect(detail.lines.map((l) => l.available === null || typeof l.available === 'number')).toEqual([true, true]);
      expect(JSON.stringify(detail)).not.toMatch(/cost/i);
      expect(quote.id).not.toBe(q.id);
    });
  });

  describe('tenant isolation and permissions', () => {
    it('another company cannot send, renew or reject', async () => {
      const { quote } = await draft();
      fx.useCompany(state.otherCompanyId);
      const other = fx.as(state.other).quoteLifecycle;
      expect(await codeOf(other.send(quote.id, { channel: 'PDF' }))).toBe('QUOTE_NOT_FOUND');
      expect(await codeOf(other.renew(quote.id, {}))).toBe('QUOTE_NOT_FOUND');
      expect(await codeOf(other.reject(quote.id))).toBe('QUOTE_NOT_FOUND');
    });
  });
});
