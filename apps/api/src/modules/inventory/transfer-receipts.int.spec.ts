/**
 * Integration test of receiving a transfer (HU-INV-21) against the real Postgres (DATABASE_URL): receiving sessions write
 * `TRANSFER_IN` movements at the destination, closing turns the differences into one pending adjustment that writes no
 * stock, and the `AJ-` series is shared with the quick adjustments. Concurrency: sessions and closes on the same transfer run
 * one after the other, so the received total never exceeds what was sent and there is never more than one adjustment.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { tenantExtension } from '../../common/prisma/tenant.extension';
import { SettingsService } from '../../common/settings/settings.service';
import { AdjustmentDocumentsService } from './adjustment-documents.service';
import { nextAdjustmentNumber } from './adjustment-number';
import { StockMovementService } from './stock-movement.service';
import { TransferReceiptsService } from './transfer-receipts.service';
import { TransfersService } from './transfers.service';

const run = randomUUID().slice(0, 8);

let current: string | null = null;
let currentMembership: string | null = null;
let currentUser: string | null = null;
class TestPrisma extends PrismaClient {
  readonly tenant = this.$extends(tenantExtension(() => current));
}
const base = new TestPrisma();
const prisma = base as unknown as PrismaService;
const cls = {
  get: (k: string) => (k === 'companyId' ? current : k === 'membershipId' ? currentMembership : k === 'userId' ? currentUser : null),
} as never;

const ALL = ['inventory.transfers.create', 'inventory.transfers.receive', 'inventory.costs.view'];
let granted = new Set<string>(ALL);
let restrictedMembershipId = '';
let restrictedBranchId = '';
const membership = {
  permissions: async () => granted,
  operableBranchIds: async (id: string) => (id === restrictedMembershipId ? [restrictedBranchId] : null),
} as never;

const settings = new SettingsService(prisma);
const stockService = new StockMovementService(cls, settings);
const audit = new AuditService(prisma, cls);
const outbox = new OutboxService(prisma, cls);
const transfers = new TransfersService(prisma, cls, stockService, settings, audit, outbox, membership);
const receipts = new TransferReceiptsService(prisma, cls, stockService, audit, outbox, membership, new AdjustmentDocumentsService(audit, outbox), transfers);

/** The immutability trigger blocks DELETE on stock_movements; test cleanup bypasses it inside its own transaction. */
async function purgeMovements(companyIds: string[]) {
  await base.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    await tx.stockMovement.deleteMany({ where: { companyId: { in: companyIds } } });
  });
}

/** The error code of a rejected call, or null when it succeeds. */
async function codeOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    return (err as { getResponse(): { code: string } }).getResponse().code;
  }
}

describe('TransferReceiptsService (integration, real Postgres)', () => {
  let companyId: string;
  let otherCompanyId: string;
  let central: string;
  let north: string;
  let brandId: string;
  let categoryId: string;
  let userId: string;
  let membershipId: string;
  let seq = 0;

  async function productWithStock(stock: number, cost = '5.0000') {
    seq += 1;
    const product = await base.product.create({
      data: { companyId, sku: `RC-${run}-${seq}`, manufacturerCode: `RCC-${run}-${seq}`, brandId, categoryId, name: 'Receipt test', salePrice: '10.00', cost, status: 'ACTIVE' },
    });
    await base.tenant.$transaction((tx) =>
      stockService.apply(tx, { productId: product.id, warehouseId: central, type: 'INITIAL', quantity: stock, reason: 'Initial load' }),
    );
    return product;
  }

  /** A transfer central → north that has been sent: `lines` are [product, quantity]. */
  async function sentTransfer(lines: [{ id: string }, number][]) {
    const draft = await transfers.create({
      originWarehouseId: central,
      destinationWarehouseId: north,
      lines: lines.map(([p, quantity]) => ({ productId: p.id, quantity })),
    } as never);
    return transfers.send(draft.id, {});
  }

  const stamp = async (id: string) => (await transfers.get(id)).updatedAt;
  const levelOf = async (productId: string, warehouseId: string) =>
    (await base.stockLevel.findFirst({ where: { productId, warehouseId } }))?.quantity ?? 0;
  const session = async (id: string, counts: [{ id: string }, number][], over: Record<string, unknown> = {}) =>
    receipts.receive(id, { lines: counts.map(([p, quantity]) => ({ productId: p.id, quantity })), expectedUpdatedAt: await stamp(id), ...over } as never);
  const close = async (id: string, surplus: [{ id: string }, number][] = [], over: Record<string, unknown> = {}) =>
    receipts.close(id, { surplus: surplus.map(([p, quantity]) => ({ productId: p.id, quantity })), expectedUpdatedAt: await stamp(id), ...over } as never);

  beforeAll(async () => {
    const company = await base.company.create({ data: { slug: `rc-${run}`, legalName: 'rc', tradeName: 'rc', nit: `R${run}`.slice(0, 20) } });
    const other = await base.company.create({ data: { slug: `rc2-${run}`, legalName: 'rc2', tradeName: 'rc2', nit: `S${run}`.slice(0, 20) } });
    companyId = company.id;
    otherCompanyId = other.id;
    current = companyId;
    const branch0 = await base.branch.create({ data: { companyId, code: 0, name: 'Central' } });
    const branch1 = await base.branch.create({ data: { companyId, code: 1, name: 'Norte' } });
    restrictedBranchId = branch0.id;
    central = (await base.warehouse.create({ data: { companyId, branchId: branch0.id, code: `C-${run}`, name: 'Almacén Central', isMain: true } })).id;
    north = (await base.warehouse.create({ data: { companyId, branchId: branch1.id, code: `N-${run}`, name: 'Almacén Norte', isMain: true } })).id;
    const country = await base.country.create({ data: { companyId, code: 'SE', name: 'Suecia' } });
    brandId = (await base.brand.create({ data: { companyId, name: `Marca ${run}`, countryId: country.id } })).id;
    categoryId = (await base.category.create({ data: { companyId, name: `Cat ${run}` } })).id;

    const role = await base.role.create({ data: { companyId, key: 'warehouse', name: 'Almacén' } });
    userId = (await base.user.create({ data: { email: `rc-${run}@example.com`, name: 'Receiver' } })).id;
    const user2 = await base.user.create({ data: { email: `rc2-${run}@example.com`, name: 'Restricted' } });
    membershipId = (await base.membership.create({ data: { companyId, userId, roleId: role.id, allBranches: true } })).id;
    restrictedMembershipId = (
      await base.membership.create({ data: { companyId, userId: user2.id, roleId: role.id, branches: { create: { branchId: branch0.id } } } })
    ).id;
    currentMembership = membershipId;
    currentUser = userId;
  });

  afterAll(async () => {
    await purgeMovements([companyId, otherCompanyId]);
    await base.outboxEvent.deleteMany({ where: { companyId } });
    await base.auditLog.deleteMany({ where: { companyId } });
    await base.stockAdjustmentItem.deleteMany({ where: { companyId } });
    await base.stockAdjustment.deleteMany({ where: { companyId } });
    await base.transferReceiptItem.deleteMany({ where: { companyId } });
    await base.transferReceipt.deleteMany({ where: { companyId } });
    await base.transferItem.deleteMany({ where: { companyId } });
    await base.transfer.deleteMany({ where: { companyId } });
    await base.stockLevel.deleteMany({ where: { companyId } });
    await base.product.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
    await base.membership.deleteMany({ where: { companyId } });
    await base.user.deleteMany({ where: { email: { in: [`rc-${run}@example.com`, `rc2-${run}@example.com`] } } });
    await base.role.deleteMany({ where: { companyId } });
    await base.category.deleteMany({ where: { companyId } });
    await base.brand.deleteMany({ where: { companyId } });
    await base.warehouse.deleteMany({ where: { companyId } });
    await base.branch.deleteMany({ where: { companyId } });
    await base.country.deleteMany({ where: { companyId } });
    await base.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
    await base.$disconnect();
  });

  beforeEach(() => {
    current = companyId;
    currentMembership = membershipId;
    granted = new Set(ALL);
  });

  describe('in-transit detail (IN-24a)', () => {
    it('shows who sent it, the lines with sent, received and pending pieces, and lists it as incoming', async () => {
      const a = await productWithStock(20);
      const sent = await sentTransfer([[a, 10]]);
      await session(sent.id, [[a, 4]]);

      const detail = await transfers.get(sent.id);
      expect(detail.status).toBe('PARTIALLY_RECEIVED');
      expect(detail.sentBy).toBe('Receiver');
      expect(detail.lines[0]).toMatchObject({ quantity: 10, receivedQuantity: 4, pendingQuantity: 6, surplusQuantity: 0, unitCost: '5.0000' });
      expect(detail.receipts).toHaveLength(1);
      expect(detail.receipts[0]).toMatchObject({ pieces: 4, receivedBy: 'Receiver' });
      expect(detail.adjustment).toBeNull();

      const incoming = await transfers.incoming({});
      expect(incoming.items.map((i) => i.id)).toContain(sent.id);
      expect(incoming.items.every((i) => ['IN_TRANSIT', 'PARTIALLY_RECEIVED'].includes(i.status))).toBe(true);
    });

    it('lists only what is headed to the member branches, and refuses a status that is not on its way', async () => {
      const a = await productWithStock(10);
      const sent = await sentTransfer([[a, 2]]);

      currentMembership = restrictedMembershipId; // operates only the origin branch
      expect((await transfers.incoming({})).items.map((i) => i.id)).not.toContain(sent.id);
      currentMembership = membershipId;
      expect((await transfers.incoming({})).items.map((i) => i.id)).toContain(sent.id);

      expect(await codeOf(transfers.incoming({ status: 'RECEIVED' }))).toBe('INVALID_FILTER');
      granted = new Set(['inventory.transfers.create']);
      expect(await codeOf(transfers.incoming({}))).toBe('NO_PERMISSION');
    });
  });

  describe('receipt per product (IN-24b)', () => {
    it('a partial session writes TRANSFER_IN at the destination and leaves the origin untouched', async () => {
      const a = await productWithStock(20);
      const sent = await sentTransfer([[a, 10]]);
      expect(await levelOf(a.id, central)).toBe(10);

      const after = await session(sent.id, [[a, 6]]);
      expect(after.status).toBe('PARTIALLY_RECEIVED');
      expect(await levelOf(a.id, north)).toBe(6);
      expect(await levelOf(a.id, central)).toBe(10);

      const movement = await base.stockMovement.findFirstOrThrow({ where: { productId: a.id, warehouseId: north } });
      expect(movement).toMatchObject({ type: 'TRANSFER_IN', quantity: 6, balanceAfter: 6, refType: 'TRANSFER_RECEIPT', refNumber: sent.number });
      expect(movement.unitCost?.toFixed(4)).toBe('5.0000');
      expect(movement.refId).toBe(after.receipts[0].id);
    });

    it('a second session completes the transfer, and nothing can be received after that', async () => {
      const a = await productWithStock(20);
      const sent = await sentTransfer([[a, 10]]);
      await session(sent.id, [[a, 6]]);
      const done = await session(sent.id, [[a, 4]]);
      expect(done.status).toBe('RECEIVED');
      expect(done.receivedBy).toBe('Receiver');
      expect(done.adjustment).toBeNull();
      expect(await levelOf(a.id, north)).toBe(10);

      expect(await codeOf(session(sent.id, [[a, 1]]))).toBe('INVALID_TRANSITION');
      expect(await codeOf(close(sent.id))).toBe('INVALID_TRANSITION');
    });

    it('refuses more than was sent, an empty session and an unknown product, writing nothing', async () => {
      const a = await productWithStock(20);
      const b = await productWithStock(5);
      const sent = await sentTransfer([[a, 10]]);
      expect(await codeOf(session(sent.id, [[a, 11]]))).toBe('RECEIPT_EXCEEDS_SENT');
      expect(await codeOf(session(sent.id, [[a, 0]]))).toBe('RECEIPT_EMPTY');
      expect(await codeOf(session(sent.id, [[b, 1]]))).toBe('RECEIPT_LINE_INVALID');
      expect(await levelOf(a.id, north)).toBe(0);
      expect(await base.transferReceipt.count({ where: { transferId: sent.id } })).toBe(0);
    });

    it('a session cannot go above what was sent counting earlier sessions', async () => {
      const a = await productWithStock(20);
      const sent = await sentTransfer([[a, 10]]);
      await session(sent.id, [[a, 7]]);
      expect(await codeOf(session(sent.id, [[a, 4]]))).toBe('RECEIPT_EXCEEDS_SENT');
      expect((await session(sent.id, [[a, 3]])).status).toBe('RECEIVED');
    });

    it('is refused without the receive permission and outside the destination branch', async () => {
      const a = await productWithStock(20);
      const sent = await sentTransfer([[a, 10]]);
      granted = new Set(['inventory.transfers.create']);
      expect(await codeOf(session(sent.id, [[a, 1]]))).toBe('NO_PERMISSION');
      granted = new Set(ALL);
      currentMembership = restrictedMembershipId; // operates the origin branch, not the destination one
      expect(await codeOf(session(sent.id, [[a, 1]]))).toBe('TRANSFER_NOT_FOUND');
      currentMembership = membershipId;
      current = otherCompanyId; // another company never sees it
      expect(await codeOf(receipts.receive(sent.id, { lines: [{ productId: a.id, quantity: 1 }], expectedUpdatedAt: new Date().toISOString() } as never))).toBe('TRANSFER_NOT_FOUND');
    });

    it('refuses a transfer that is not on its way, and a stale updatedAt', async () => {
      const a = await productWithStock(20);
      const draft = await transfers.create({ originWarehouseId: central, destinationWarehouseId: north, lines: [{ productId: a.id, quantity: 2 }] } as never);
      expect(await codeOf(receipts.receive(draft.id, { lines: [{ productId: a.id, quantity: 1 }], expectedUpdatedAt: draft.updatedAt } as never))).toBe('INVALID_TRANSITION');

      const sent = await sentTransfer([[a, 5]]);
      const stale = await stamp(sent.id);
      await session(sent.id, [[a, 1]]);
      expect(await codeOf(receipts.receive(sent.id, { lines: [{ productId: a.id, quantity: 1 }], expectedUpdatedAt: stale } as never))).toBe('TRANSFER_MODIFIED');
    });

    it('audits and publishes every step', async () => {
      const a = await productWithStock(20);
      const sent = await sentTransfer([[a, 4]]);
      const partial = await session(sent.id, [[a, 1]]);
      await session(sent.id, [[a, 3]]);

      const actions = (await base.auditLog.findMany({ where: { companyId, entityId: sent.id }, select: { action: true } })).map((r) => r.action);
      expect(actions.filter((x) => x === 'inventory.transfer.receive')).toHaveLength(2);
      const events = await base.outboxEvent.findMany({ where: { companyId, type: { in: ['inventory.transfer.received_partial', 'inventory.transfer.received'] } } });
      const mine = events.filter((e) => (e.payload as { transferId?: string }).transferId === sent.id).map((e) => e.type).sort();
      expect(mine).toEqual(['inventory.transfer.received', 'inventory.transfer.received_partial']);
      expect(partial.receipts).toHaveLength(1);
    });
  });

  describe('differences generate a pending adjustment (IN-07)', () => {
    it('closing with a shortage and a surplus creates one pending adjustment and moves no stock', async () => {
      const a = await productWithStock(20);
      const b = await productWithStock(20, '2.5000');
      const sent = await sentTransfer([[a, 10], [b, 10]]);
      await session(sent.id, [[a, 8], [b, 10]]);
      const stockBefore = [await levelOf(a.id, north), await levelOf(b.id, north)];
      const movementsBefore = await base.stockMovement.count({ where: { companyId } });

      const closed = await close(sent.id, [[b, 2]]);

      expect(closed.status).toBe('RECEIVED');
      expect(closed.adjustment).toMatchObject({ status: 'PENDING_APPROVAL', totalValue: '15.00' });
      expect(closed.adjustment?.number).toMatch(/^AJ-\d{6}$/);
      const adjustment = await base.stockAdjustment.findFirstOrThrow({ where: { transferId: sent.id }, include: { items: true } });
      expect(adjustment).toMatchObject({ source: 'TRANSFER', status: 'PENDING_APPROVAL', warehouseId: north, reason: 'Diferencia en transferencia' });
      const byProduct = new Map(adjustment.items.map((i) => [i.productId, i]));
      expect(byProduct.get(a.id)).toMatchObject({ kind: 'SHORTAGE', quantity: -2 });
      expect(byProduct.get(a.id)?.unitCost?.toFixed(4)).toBe('5.0000');
      expect(byProduct.get(b.id)).toMatchObject({ kind: 'SURPLUS', quantity: 2 });
      expect(byProduct.get(b.id)?.unitCost?.toFixed(4)).toBe('2.5000');

      // the close writes no stock: A stays at the 8 received, B at the 10 received (the surplus is not in stock)
      expect([await levelOf(a.id, north), await levelOf(b.id, north)]).toEqual(stockBefore);
      expect(stockBefore).toEqual([8, 10]);
      expect(await base.stockMovement.count({ where: { companyId } })).toBe(movementsBefore);
      const lines = closed.lines;
      expect(lines.find((l) => l.productId === b.id)?.surplusQuantity).toBe(2);
    });

    it('marks the transfer in the list while its adjustment is pending, and not when there is none or it was decided', async () => {
      const a = await productWithStock(20);
      const withDifferences = await sentTransfer([[a, 5]]);
      const closed = await close(withDifferences.id, [], { lines: [{ productId: a.id, quantity: 3 }] });
      const clean = await sentTransfer([[a, 2]]);
      await session(clean.id, [[a, 2]]);

      const listed = await transfers.list({ pageSize: 100 });
      const byId = new Map(listed.items.map((i) => [i.id, i]));
      expect(byId.get(withDifferences.id)?.pendingAdjustment).toEqual({ number: closed.adjustment?.number });
      expect(byId.get(clean.id)?.pendingAdjustment).toBeNull();

      await base.stockAdjustment.update({ where: { id: closed.adjustment?.id as string }, data: { status: 'APPROVED' } });
      const after = await transfers.list({ pageSize: 100 });
      expect(after.items.find((i) => i.id === withDifferences.id)?.pendingAdjustment).toBeNull();
    });

    it('applies a last count when closing and counts everything not received as a shortage', async () => {
      const a = await productWithStock(20);
      const b = await productWithStock(20);
      const sent = await sentTransfer([[a, 10], [b, 6]]);
      const closed = await close(sent.id, [], { lines: [{ productId: a.id, quantity: 7 }] });

      expect(await levelOf(a.id, north)).toBe(7);
      expect(await levelOf(b.id, north)).toBe(0);
      const adjustment = await base.stockAdjustment.findFirstOrThrow({ where: { transferId: sent.id }, include: { items: true } });
      expect(adjustment.items.map((i) => [i.quantity]).flat().sort((x, y) => x - y)).toEqual([-6, -3]);
      expect(closed.status).toBe('RECEIVED');
      expect(closed.adjustment?.totalValue).toBe('45.00');
    });

    it('checks the final count of a close even when every entry is 0', async () => {
      const a = await productWithStock(20);
      const b = await productWithStock(5);
      const sent = await sentTransfer([[a, 4]]);
      expect(await codeOf(close(sent.id, [], { lines: [{ productId: b.id, quantity: 0 }] }))).toBe('RECEIPT_LINE_INVALID');
      expect(await codeOf(close(sent.id, [], { lines: [{ productId: a.id, quantity: 0 }, { productId: a.id, quantity: 0 }] }))).toBe('RECEIPT_LINE_INVALID');
      expect((await transfers.get(sent.id)).status).toBe('IN_TRANSIT');
    });

    it('closing with no differences creates no adjustment', async () => {
      const a = await productWithStock(20);
      const sent = await sentTransfer([[a, 4]]);
      await session(sent.id, [[a, 3]]);
      const closed = await close(sent.id, [], { lines: [{ productId: a.id, quantity: 1 }] });
      expect(closed.status).toBe('RECEIVED');
      expect(closed.adjustment).toBeNull();
      expect(await base.stockAdjustment.count({ where: { transferId: sent.id } })).toBe(0);
    });

    it('refuses a surplus on a line that is still short', async () => {
      const a = await productWithStock(20);
      const sent = await sentTransfer([[a, 10]]);
      await session(sent.id, [[a, 6]]);
      expect(await codeOf(close(sent.id, [[a, 1]]))).toBe('SURPLUS_NOT_ALLOWED');
      expect((await transfers.get(sent.id)).status).toBe('PARTIALLY_RECEIVED');
      expect(await base.stockAdjustment.count({ where: { transferId: sent.id } })).toBe(0);
    });

    it('audits the close and the adjustment and publishes both events', async () => {
      const a = await productWithStock(20);
      const sent = await sentTransfer([[a, 10]]);
      const closed = await close(sent.id, [], { lines: [{ productId: a.id, quantity: 9 }] });
      const adjustmentId = closed.adjustment?.id as string;

      const actions = (await base.auditLog.findMany({ where: { companyId }, select: { action: true, entityId: true } }))
        .filter((r) => r.entityId === sent.id || r.entityId === adjustmentId)
        .map((r) => r.action);
      expect(actions).toEqual(expect.arrayContaining(['inventory.transfer.receive', 'inventory.transfer.close', 'inventory.adjustment.create']));
      const types = (await base.outboxEvent.findMany({ where: { companyId } }))
        .filter((e) => [sent.id, adjustmentId].includes((e.payload as { transferId?: string; adjustmentId?: string }).transferId ?? (e.payload as { adjustmentId?: string }).adjustmentId ?? ''))
        .map((e) => e.type);
      expect(types).toEqual(expect.arrayContaining(['inventory.transfer.received', 'inventory.adjustment.pending']));
    });

    it('shares the AJ- series with the quick adjustments', async () => {
      const a = await productWithStock(20);
      await base.tenant.$transaction((tx) =>
        stockService.apply(tx, { productId: a.id, warehouseId: central, type: 'ADJUSTMENT_OUT', quantity: -1, reason: 'Merma', refType: 'ADJUSTMENT', refNumber: 'AJ-000900' }),
      );
      const sent = await sentTransfer([[a, 5]]);
      const closed = await close(sent.id);
      expect(closed.adjustment?.number).toBe('AJ-000901');
      expect(await base.tenant.$transaction((tx) => nextAdjustmentNumber(tx, companyId))).toBe('AJ-000902');
    });
  });

  describe('cancelling a sent transfer', () => {
    it('gives the pieces back to the origin, audits it and leaves nothing to receive', async () => {
      const a = await productWithStock(20);
      const sent = await sentTransfer([[a, 10]]);
      expect(await levelOf(a.id, central)).toBe(10);

      const cancelled = await transfers.cancel(sent.id, { expectedUpdatedAt: await stamp(sent.id), reason: 'Error de destino' });

      expect(cancelled.status).toBe('CANCELLED');
      expect(await levelOf(a.id, central)).toBe(20);
      expect(await levelOf(a.id, north)).toBe(0);
      const back = await base.stockMovement.findFirstOrThrow({ where: { productId: a.id, warehouseId: central, type: 'TRANSFER_IN' } });
      expect(back).toMatchObject({ quantity: 10, balanceAfter: 20, refType: 'TRANSFER', refId: sent.id, refNumber: sent.number });
      expect(back.unitCost?.toFixed(4)).toBe('5.0000');

      const audit = await base.auditLog.findFirstOrThrow({ where: { companyId, action: 'inventory.transfer.cancel', entityId: sent.id } });
      expect(audit.after).toMatchObject({ status: 'CANCELLED', returnedPieces: 10, reason: 'Error de destino' });
      expect(await base.outboxEvent.count({ where: { companyId, type: 'inventory.transfer.cancelled', idempotencyKey: `inventory.transfer.cancelled:${sent.id}` } })).toBe(1);

      expect(await codeOf(session(sent.id, [[a, 1]]))).toBe('INVALID_TRANSITION');
      expect(await codeOf(transfers.cancel(sent.id))).toBe('INVALID_TRANSITION');
      expect(await levelOf(a.id, central)).toBe(20);
    });

    it('is refused once part of it was received, writing nothing', async () => {
      const a = await productWithStock(20);
      const sent = await sentTransfer([[a, 10]]);
      await session(sent.id, [[a, 4]]);
      expect(await codeOf(transfers.cancel(sent.id))).toBe('INVALID_TRANSITION');
      expect(await levelOf(a.id, central)).toBe(10);
      expect((await transfers.get(sent.id)).status).toBe('PARTIALLY_RECEIVED');
    });

    it('is refused for a stale updatedAt and without the create permission', async () => {
      const a = await productWithStock(20);
      const sent = await sentTransfer([[a, 3]]);
      const stale = await stamp(sent.id);
      await session(sent.id, [[a, 1]]);
      expect(await codeOf(transfers.cancel(sent.id, { expectedUpdatedAt: stale }))).toBe('TRANSFER_MODIFIED');

      const other = await sentTransfer([[a, 2]]);
      granted = new Set(['inventory.transfers.receive']);
      expect(await codeOf(transfers.cancel(other.id))).toBe('NO_PERMISSION');
    });

    it('a cancel racing a receipt session: exactly one wins and stock matches the winner', async () => {
      const a = await productWithStock(20);
      const sent = await sentTransfer([[a, 10]]);
      const expectedUpdatedAt = await stamp(sent.id);

      const results = await Promise.allSettled([
        transfers.cancel(sent.id, { expectedUpdatedAt }),
        receipts.receive(sent.id, { lines: [{ productId: a.id, quantity: 6 }], expectedUpdatedAt } as never),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

      const status = (await transfers.get(sent.id)).status;
      if (status === 'CANCELLED') {
        expect([await levelOf(a.id, central), await levelOf(a.id, north)]).toEqual([20, 0]);
      } else {
        expect(status).toBe('PARTIALLY_RECEIVED');
        expect([await levelOf(a.id, central), await levelOf(a.id, north)]).toEqual([10, 6]);
      }
    });
  });

  describe('concurrency', () => {
    it('two sessions on the same line at once: one wins, the total never exceeds what was sent', async () => {
      const a = await productWithStock(20);
      const sent = await sentTransfer([[a, 10]]);
      const expectedUpdatedAt = await stamp(sent.id);
      const attempt = () => receipts.receive(sent.id, { lines: [{ productId: a.id, quantity: 6 }], expectedUpdatedAt } as never);

      const results = await Promise.allSettled([attempt(), attempt()]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failure = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(['TRANSFER_MODIFIED', 'RECEIPT_EXCEEDS_SENT']).toContain((failure.reason as { getResponse(): { code: string } }).getResponse().code);

      expect(await levelOf(a.id, north)).toBe(6);
      expect((await base.transferItem.findFirstOrThrow({ where: { transferId: sent.id } })).receivedQuantity).toBe(6);
    });

    it('sessions that each read fresh data add up and never exceed the sent quantity', async () => {
      const a = await productWithStock(20);
      const sent = await sentTransfer([[a, 10]]);
      // each caller reads the transfer after the lock would be taken: the stamp is re-read until the call is accepted
      const keepTrying = async () => {
        for (let i = 0; i < 20; i++) {
          try {
            return await receipts.receive(sent.id, { lines: [{ productId: a.id, quantity: 3 }], expectedUpdatedAt: await stamp(sent.id) } as never);
          } catch (err) {
            const code = (err as { getResponse(): { code: string } }).getResponse().code;
            if (code === 'RECEIPT_EXCEEDS_SENT' || code === 'INVALID_TRANSITION') return null;
            if (code !== 'TRANSFER_MODIFIED') throw err;
          }
        }
        return null;
      };
      await Promise.all([keepTrying(), keepTrying(), keepTrying(), keepTrying()]);
      const item = await base.transferItem.findFirstOrThrow({ where: { transferId: sent.id } });
      expect(item.receivedQuantity).toBe(9); // three sessions of 3; the fourth would be 12 > 10
      expect(await levelOf(a.id, north)).toBe(9);
    });

    it('a close racing a session leaves exactly one adjustment and movements matching what was received', async () => {
      const a = await productWithStock(20);
      const sent = await sentTransfer([[a, 10]]);
      const expectedUpdatedAt = await stamp(sent.id);

      const results = await Promise.allSettled([
        receipts.receive(sent.id, { lines: [{ productId: a.id, quantity: 4 }], expectedUpdatedAt } as never),
        receipts.close(sent.id, { surplus: [], expectedUpdatedAt } as never),
        receipts.close(sent.id, { surplus: [], expectedUpdatedAt } as never),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);

      expect(await base.stockAdjustment.count({ where: { transferId: sent.id } })).toBeLessThanOrEqual(1);
      const item = await base.transferItem.findFirstOrThrow({ where: { transferId: sent.id } });
      const moved = await base.stockMovement.aggregate({ where: { productId: a.id, warehouseId: north }, _sum: { quantity: true } });
      expect(moved._sum.quantity ?? 0).toBe(item.receivedQuantity);
      expect(await levelOf(a.id, north)).toBe(item.receivedQuantity);
    });

    it('the kardex balance matches stock_levels at the destination after several sessions', async () => {
      const a = await productWithStock(30);
      const sent = await sentTransfer([[a, 12]]);
      await session(sent.id, [[a, 5]]);
      await session(sent.id, [[a, 4]]);
      await close(sent.id);

      const movements = await base.stockMovement.findMany({ where: { productId: a.id, warehouseId: north }, orderBy: { createdAt: 'asc' } });
      expect(movements.at(-1)?.balanceAfter).toBe(await levelOf(a.id, north));
      expect(movements.reduce((sum, m) => sum + m.quantity, 0)).toBe(9);
    });
  });
});
