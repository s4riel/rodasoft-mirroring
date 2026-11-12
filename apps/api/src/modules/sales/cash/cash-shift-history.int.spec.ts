/**
 * Integration test of the shift history (HU-VEN-25) against the real Postgres: the list by date, cashier, totals and difference,
 * its filters, the totals of the filtered set, the month KPIs, and who sees what (a reviewer every shift, a cashier their own).
 */
import { randomUUID } from 'node:crypto';
import type { Caller } from '../pos/pos.int-fixture';
import { codeOf, createPosFixture } from '../pos/pos.int-fixture';

jest.setTimeout(30_000);

const fx = createPosFixture('cashhistory');
const { state } = fx;
const run = randomUUID().slice(0, 8);

const OPEN = 'sales.cash-register.open';
const REVIEW = 'sales.cash-register.review';

const count = (denomination: string, quantity: number) => ({ denomination, quantity });
const SHORT = { counts: [count('100', 5), count('20', 4)], declared: { QR: '100.00', CARD: '0', TRANSFER: '0' }, closingFloat: '100.00', comment: 'Faltó un vuelto' };
const CLEAN = { counts: [count('200', 3)], declared: { QR: '100.00', CARD: '0', TRANSFER: '0' }, closingFloat: '500.00' };
/** The cash is right but the QR total is Bs 5 over. */
const QR_OVER = { ...CLEAN, declared: { QR: '105.00', CARD: '0', TRANSFER: '0' }, comment: 'Un QR duplicado' };

type Shift = { caller: Caller; shiftId: string; registerId: string };

describe('Shift history (integration, real Postgres)', () => {
  let seq = 0;
  let accountant: Caller;
  let pending: Shift;
  let clean: Shift;
  let approved: Shift;
  let observed: Shift;
  let stillOpen: Shift;

  /** A cashier whose shift expects Bs 600 in cash and Bs 100 in QR, from two sales. */
  async function openShift(label: string): Promise<Shift> {
    const shift = await fx.newShift(label, '100.00');
    fx.grant(shift.caller, OPEN);
    await addSale(shift, 'CASH', '500.00');
    await addSale(shift, 'QR', '100.00');
    return shift;
  }

  async function addSale(shift: Shift, method: 'CASH' | 'QR', amount: string, status: 'COMPLETED' | 'CANCELLED' = 'COMPLETED') {
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
        status,
        subtotal: amount,
        total: amount,
        createdById: shift.caller.userId,
        payments: { create: [{ companyId: state.companyId, method, amount }] },
      },
    });
    if (method === 'CASH' && status === 'COMPLETED') {
      await state.base.cashMovement.create({
        data: { companyId: state.companyId, shiftId: shift.shiftId, type: 'SALE_PAYMENT', amount, userId: shift.caller.userId, refType: 'SALE', refId: sale.id },
      });
    }
  }

  async function closed(label: string, closing: object): Promise<Shift> {
    const shift = await openShift(label);
    await fx.as(shift.caller).cashClosing.close(shift.shiftId, closing as never);
    return shift;
  }

  const history = (caller: Caller) => fx.as(caller).cashHistory;
  const row = async (caller: Caller, shiftId: string, query: object = {}) =>
    (await history(caller).list({ pageSize: 100, ...query })).items.find((i) => i.id === shiftId);

  beforeAll(async () => {
    await fx.setup();
    accountant = await fx.newMember('accountant', state.companyId);
    fx.grant(accountant, REVIEW);
    pending = await closed('pending', SHORT);
    clean = await closed('clean', CLEAN);
    approved = await closed('approved', SHORT);
    await fx.as(accountant).cashReview.approve(approved.shiftId, {});
    observed = await closed('observed', QR_OVER);
    await fx.as(accountant).cashReview.observe(observed.shiftId, { comment: 'Revisar el QR' });
    stillOpen = await openShift('open');
    // a cancelled sale never counts in the sales of a shift
    await addSale(stillOpen, 'QR', '999.00', 'CANCELLED');
  }, 90_000);
  afterAll(() => fx.teardown());
  beforeEach(() => fx.useCompany(state.companyId));

  describe('the list', () => {
    it('shows number, cashier, register, schedule, sales and difference of each shift', async () => {
      const item = await row(accountant, pending.shiftId);
      const stored = await state.base.cashShift.findUniqueOrThrow({ where: { id: pending.shiftId } });
      expect(item).toMatchObject({
        id: pending.shiftId,
        number: stored.number,
        status: 'CLOSED',
        displayStatus: 'PENDING_REVIEW',
        cashier: { id: pending.caller.userId },
        register: { id: pending.registerId },
        branch: { id: state.branchId, name: 'Sucursal central' },
        openedAt: stored.openedAt.toISOString(),
        closedAt: stored.closedAt?.toISOString(),
        sales: { total: '600.00', count: 2 },
        difference: '-20.00',
        hasDifference: true,
      });
      expect(item?.cashier.name).toContain('User pending');
      expect(item?.register.name).toMatch(/^Caja /);
    });

    it('tells every status apart', async () => {
      const { items } = await history(accountant).list({ pageSize: 100 });
      const status = (id: string) => items.find((i) => i.id === id)?.displayStatus;
      expect(status(pending.shiftId)).toBe('PENDING_REVIEW');
      expect(status(clean.shiftId)).toBe('CLOSED_CLEAN');
      expect(status(approved.shiftId)).toBe('DIFFERENCE_APPROVED');
      expect(status(observed.shiftId)).toBe('OBSERVED');
      expect(status(stillOpen.shiftId)).toBe('OPEN');
    });

    it('flags a difference in any payment method, and none on a clean or open shift', async () => {
      // the cash matched; only the QR total differs
      expect(await row(accountant, observed.shiftId)).toMatchObject({ difference: '0.00', hasDifference: true });
      expect(await row(accountant, clean.shiftId)).toMatchObject({ difference: '0.00', hasDifference: false });
      expect(await row(accountant, stillOpen.shiftId)).toMatchObject({ difference: null, hasDifference: false, closedAt: null, sales: { total: '600.00', count: 2 } });
    });

    it('lists the newest opening first and pages', async () => {
      const all = await history(accountant).list({ pageSize: 100 });
      const opened = all.items.map((i) => i.openedAt);
      expect(opened).toEqual([...opened].sort().reverse());
      expect(all.total).toBe(all.items.length);

      const first = await history(accountant).list({ page: 1, pageSize: 2 });
      const second = await history(accountant).list({ page: 2, pageSize: 2 });
      expect(first).toMatchObject({ page: 1, pageSize: 2, total: all.total });
      expect([...first.items, ...second.items].map((i) => i.id)).toEqual(all.items.slice(0, 4).map((i) => i.id));
    });
  });

  describe('filters', () => {
    it('filters by cashier and by register', async () => {
      const byCashier = await history(accountant).list({ cashierId: pending.caller.userId });
      expect(byCashier.items.map((i) => i.id)).toEqual([pending.shiftId]);
      const byRegister = await history(accountant).list({ registerId: clean.registerId });
      expect(byRegister.items.map((i) => i.id)).toEqual([clean.shiftId]);
    });

    it.each([
      ['PENDING_REVIEW', () => pending],
      ['CLOSED_CLEAN', () => clean],
      ['DIFFERENCE_APPROVED', () => approved],
      ['OBSERVED', () => observed],
    ] as const)('filters by status %s', async (status, pick) => {
      const { items } = await history(accountant).list({ status, pageSize: 100 });
      expect(items.map((i) => i.id)).toContain(pick().shiftId);
      expect(items.every((i) => i.displayStatus === status)).toBe(true);
    });

    it('filters by the La Paz day of the opening', async () => {
      const old = await closed('old', CLEAN);
      // 03:30 UTC on the 15th is still the 14th, 23:30, in La Paz
      await state.base.cashShift.update({ where: { id: old.shiftId }, data: { openedAt: new Date('2026-01-15T03:30:00Z') } });

      const ids = async (query: object) => (await history(accountant).list({ pageSize: 100, ...query })).items.map((i) => i.id);
      expect(await ids({ from: '2026-01-14', to: '2026-01-14' })).toEqual([old.shiftId]);
      expect(await ids({ from: '2026-01-15', to: '2026-01-20' })).toEqual([]);
      expect(await ids({ to: '2026-01-14' })).toEqual([old.shiftId]);
      expect(await ids({ from: '2026-01-15' })).not.toContain(old.shiftId);
    });

    it('answers INVALID_FILTER for a day that does not exist and for a range upside down', async () => {
      expect(await codeOf(history(accountant).list({ from: '2026-02-31' }))).toBe('INVALID_FILTER');
      expect(await codeOf(history(accountant).list({ to: '2026-13-01' }))).toBe('INVALID_FILTER');
      expect(await codeOf(history(accountant).list({ from: '2026-03-02', to: '2026-03-01' }))).toBe('INVALID_FILTER');
    });
  });

  describe('totals and KPIs', () => {
    it('totals every shift the filters match, not only the page', async () => {
      const one = await history(accountant).list({ cashierId: pending.caller.userId });
      expect(one.totals).toEqual({ shifts: 1, salesCount: 2, salesTotal: '600.00', difference: '-20.00' });

      const paged = await history(accountant).list({ status: 'DIFFERENCE_APPROVED', pageSize: 1 });
      const whole = await history(accountant).list({ status: 'DIFFERENCE_APPROVED', pageSize: 100 });
      expect(paged.totals).toEqual(whole.totals);
      expect(whole.totals.shifts).toBe(whole.items.length);
    });

    it('counts the month: shifts, with difference, waiting for review and the accumulated difference', async () => {
      const before = (await history(accountant).list({})).month;
      await closed('kpi', SHORT);
      const after = (await history(accountant).list({})).month;

      expect(after.shifts).toBe(before.shifts + 1);
      expect(after.withDifference).toBe(before.withDifference + 1);
      expect(after.pendingReview).toBe(before.pendingReview + 1);
      expect(Number(after.accumulatedDifference) - Number(before.accumulatedDifference)).toBe(-20);
    });

    it('keeps a closing of an earlier month in "waiting for review" but out of the month figures', async () => {
      const late = await closed('last-month', SHORT);
      const before = (await history(accountant).list({})).month;
      await state.base.cashShift.update({ where: { id: late.shiftId }, data: { openedAt: new Date('2026-01-10T15:00:00Z') } });
      const after = (await history(accountant).list({})).month;

      expect(after.shifts).toBe(before.shifts - 1);
      expect(after.withDifference).toBe(before.withDifference - 1);
      expect(after.pendingReview).toBe(before.pendingReview);
    });
  });

  describe('who sees what', () => {
    it('gives a reviewer every cashier and the options of the filters', async () => {
      const list = await history(accountant).list({ pageSize: 100 });
      expect(list.canReview).toBe(true);
      expect(list.cashiers.map((c) => c.id)).toEqual(expect.arrayContaining([pending.caller.userId, clean.caller.userId]));
      expect(list.registers.map((r) => r.id)).toEqual(expect.arrayContaining([pending.registerId, clean.registerId]));
    });

    it('gives a cashier only their own shifts and ignores the cashier filter', async () => {
      const own = await history(pending.caller).list({ pageSize: 100 });
      expect(own.items.map((i) => i.id)).toEqual([pending.shiftId]);
      expect(own).toMatchObject({ canReview: false, cashiers: [], registers: [], total: 1 });
      expect(own.month).toMatchObject({ shifts: 1, withDifference: 1, pendingReview: 1, accumulatedDifference: '-20.00' });

      const other = await history(pending.caller).list({ cashierId: clean.caller.userId });
      expect(other.items.map((i) => i.id)).toEqual([pending.shiftId]);
    });

    it('limits a reviewer to the branches they operate', async () => {
      const none = await fx.as(accountant, { operableBranchIds: [randomUUID()] }).cashHistory.list({});
      expect(none).toMatchObject({ items: [], total: 0, registers: [], cashiers: [] });
      expect(none.month).toEqual({ shifts: 0, withDifference: 0, pendingReview: 0, accumulatedDifference: '0.00' });
      const central = await fx.as(accountant, { operableBranchIds: [state.branchId] }).cashHistory.list({ pageSize: 100 });
      expect(central.items.map((i) => i.id)).toContain(pending.shiftId);
    });

    it('never shows the shifts of another company', async () => {
      const foreign = await fx.newMember('foreign-acct', state.otherCompanyId);
      fx.grant(foreign, REVIEW);
      fx.useCompany(state.otherCompanyId);
      const list = await history(foreign).list({ pageSize: 100 });
      const ours = [pending, clean, approved, observed, stillOpen].map((s) => s.shiftId);
      expect(list.items.filter((i) => ours.includes(i.id))).toEqual([]);
      expect((await history(foreign).list({ cashierId: pending.caller.userId })).items).toEqual([]);
    });
  });
});
