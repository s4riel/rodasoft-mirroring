import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  applyReceiptSession,
  computeTransferDifferences,
  InvalidTransitionError,
  nextReceiptEvent,
  type ReceiptCount,
  type ReceiptLine,
  TRANSFER_RECEIPT_REF_TYPE,
  TransferError,
  type TransferDetail,
  type TransferStatus,
  transferMachine,
  validateSurplus,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import { type AuditEntry, AuditService } from '../../common/audit/audit.service';
import type { AppClsStore } from '../../common/cls';
import { OutboxService } from '../../common/outbox/outbox.service';
import { PrismaService, type TenantTransaction } from '../../common/prisma/prisma.service';
import { MembershipService } from '../access/membership.service';
import { AdjustmentDocumentsService } from './adjustment-documents.service';
import { lockAdjustmentNumbering } from './adjustment-number';
import { StockMovementService } from './stock-movement.service';
import type { CloseTransferDto, ReceiveTransferDto } from './transfers.dto';
import { TransfersService } from './transfers.service';

/** A receipt moves stock for every line: Prisma's default 5 s transaction timeout would expire on a big transfer. */
const WRITE_TRANSACTION_OPTIONS = { timeout: 120_000, maxWait: 30_000 } as const;

/** A transfer item as the receipt works on it, read after the transfer row is locked. */
interface ItemToReceive {
  id: string;
  productId: string;
  quantity: number;
  receivedQuantity: number;
  unitCost: string | null;
}

interface LockedTransfer {
  id: string;
  number: string;
  status: TransferStatus;
  destinationWarehouseId: string;
}

/**
 * Receiving a transfer at its destination (HU-INV-21). A receipt is a series of sessions: each one counts the pieces that
 * arrived for some products, writes them into the destination as `TRANSFER_IN` movements (at the cost frozen when the
 * transfer was sent) and raises the cumulative `received_quantity` of the lines. Closing finishes the receipt: it stores the
 * surplus, and any shortage or surplus becomes one pending adjustment that writes no stock. Everything runs under the lock
 * of the transfer row, so two sessions (or a session and a close) on the same transfer run one after the other.
 */
@Injectable()
export class TransferReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly stock: StockMovementService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly membership: MembershipService,
    private readonly adjustments: AdjustmentDocumentsService,
    private readonly transfers: TransfersService,
  ) {}

  /** One receiving session: the pieces counted now, per product. */
  async receive(id: string, dto: ReceiveTransferDto): Promise<TransferDetail> {
    const { companyId, userId } = await this.assertCanReceive();
    const allowed = await this.operableBranches();

    await this.writeTransaction(async (tx) => {
      await this.findReceivable(tx, id, allowed);
      const transfer = await this.lock(tx, id, companyId, dto.expectedUpdatedAt);
      if (!transferMachine.can(transfer.status, 'receivePartial')) throw invalidTransition(transfer.status, 'receivePartial');

      const items = await this.loadItems(tx, id);
      const session = await this.recordSession(tx, { transfer, items, counts: dto.lines, note: dto.note ?? null, userId, companyId });
      const event = nextReceiptEvent(session.lines);
      const to = transferMachine.next(transfer.status, event);
      const complete = event === 'receiveAll';

      await tx.transfer.update({
        where: { id },
        data: { status: to, ...(complete ? { receivedById: userId, receivedAt: new Date() } : {}) },
      });
      await this.recordAudit(tx, {
        action: 'inventory.transfer.receive',
        entity: 'Transfer',
        entityId: id,
        before: { status: transfer.status },
        after: { status: to, number: transfer.number, receiptId: session.receiptId, pieces: session.pieces },
      });
      await this.outbox.publish(
        complete ? 'inventory.transfer.received' : 'inventory.transfer.received_partial',
        { transferId: id, number: transfer.number, destinationWarehouseId: transfer.destinationWarehouseId, receiptId: session.receiptId, pieces: session.pieces, userId },
        { tx, companyId, idempotencyKey: complete ? `inventory.transfer.received:${id}` : `inventory.transfer.received_partial:${session.receiptId}` },
      );
    });
    return this.transfers.get(id);
  }

  /**
   * Finishes the receipt. `lines` is the last count (applied as one more session), `surplus` the pieces beyond what was
   * sent. Shortages and surplus become a single pending adjustment; with no differences no adjustment is created.
   */
  async close(id: string, dto: CloseTransferDto): Promise<TransferDetail> {
    const { companyId, userId } = await this.assertCanReceive();
    const allowed = await this.operableBranches();

    await this.writeTransaction(async (tx) => {
      await this.findReceivable(tx, id, allowed);
      const transfer = await this.lock(tx, id, companyId, dto.expectedUpdatedAt);
      if (!transferMachine.can(transfer.status, 'close')) throw invalidTransition(transfer.status, 'close');
      // the numbering lock before any stock lock, the order the quick adjustment uses, so the two cannot deadlock
      await lockAdjustmentNumbering(tx, companyId);

      let items = await this.loadItems(tx, id);
      // a final count is checked even when every entry is 0: an unknown or repeated product is a mistake, not a no-op
      const known = new Set(items.map((i) => i.productId));
      const counted = new Set<string>();
      for (const l of dto.lines ?? []) {
        if (!known.has(l.productId) || counted.has(l.productId)) {
          throw new UnprocessableEntityException({ code: 'RECEIPT_LINE_INVALID', message: 'The product is not on the transfer or appears twice' });
        }
        counted.add(l.productId);
      }
      if (dto.lines?.some((l) => l.quantity > 0)) {
        const session = await this.recordSession(tx, { transfer, items, counts: dto.lines, note: dto.note ?? null, userId, companyId });
        items = items.map((i) => ({ ...i, receivedQuantity: session.lines.find((l) => l.productId === i.productId)?.received ?? i.receivedQuantity }));
        await this.recordAudit(tx, {
          action: 'inventory.transfer.receive',
          entity: 'Transfer',
          entityId: id,
          before: { status: transfer.status },
          after: { status: transfer.status, number: transfer.number, receiptId: session.receiptId, pieces: session.pieces, closing: true },
        });
      }

      const lines = toReceiptLines(items);
      const surplus = asHttpRule(() => validateSurplus(lines, dto.surplus));
      for (const item of items) {
        const pieces = surplus.get(item.productId);
        if (pieces) await tx.transferItem.update({ where: { id: item.id }, data: { surplusQuantity: pieces } });
      }

      const differences = computeTransferDifferences(lines.map((l) => ({ ...l, surplus: surplus.get(l.productId) ?? 0 })));
      const adjustment = differences.length
        ? await this.adjustments.createFromTransfer(tx, { companyId, userId, transfer, differences })
        : null;

      const to = transferMachine.next(transfer.status, 'close');
      await tx.transfer.update({ where: { id }, data: { status: to, receivedById: userId, receivedAt: new Date() } });
      await this.recordAudit(tx, {
        action: 'inventory.transfer.close',
        entity: 'Transfer',
        entityId: id,
        before: { status: transfer.status },
        after: { status: to, number: transfer.number, differences: differences.length, adjustment: adjustment?.number ?? null },
      });
      await this.outbox.publish(
        'inventory.transfer.received',
        { transferId: id, number: transfer.number, destinationWarehouseId: transfer.destinationWarehouseId, differences: differences.length, adjustmentId: adjustment?.id ?? null, userId },
        { tx, companyId, idempotencyKey: `inventory.transfer.received:${id}` },
      );
    });
    return this.transfers.get(id);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /**
   * Writes one session: the receipt document, the `TRANSFER_IN` movements (products in id order, the order every other
   * movement locks them in) and the new cumulative quantity of each line.
   */
  private async recordSession(
    tx: TenantTransaction,
    ctx: { transfer: LockedTransfer; items: ItemToReceive[]; counts: readonly ReceiptCount[]; note: string | null; userId: string | null; companyId: string },
  ): Promise<{ receiptId: string; pieces: number; lines: ReceiptLine[] }> {
    const { transfer, items, counts, note, userId, companyId } = ctx;
    const session = asHttpRule(() => applyReceiptSession(toReceiptLines(items), counts)).sort((a, b) => (a.productId < b.productId ? -1 : 1));
    const itemOf = new Map(items.map((i) => [i.productId, i]));

    const receipt = await tx.transferReceipt.create({
      select: { id: true },
      data: { companyId, transferId: transfer.id, receivedById: userId, note },
    });
    await tx.transferReceiptItem.createMany({
      data: session.map((l) => ({ companyId, receiptId: receipt.id, transferItemId: (itemOf.get(l.productId) as ItemToReceive).id, quantity: l.quantity })),
    });
    for (const line of session) {
      const item = itemOf.get(line.productId) as ItemToReceive;
      await this.stock.apply(tx, {
        productId: line.productId,
        warehouseId: transfer.destinationWarehouseId,
        type: 'TRANSFER_IN',
        quantity: line.quantity,
        reason: `Recepción ${transfer.number}`,
        refType: TRANSFER_RECEIPT_REF_TYPE,
        refId: receipt.id,
        refNumber: transfer.number,
        unitCost: item.unitCost,
      });
      await tx.transferItem.update({ where: { id: item.id }, data: { receivedQuantity: line.received } });
      item.receivedQuantity = line.received;
    }

    return { receiptId: receipt.id, pieces: session.reduce((sum, l) => sum + l.quantity, 0), lines: toReceiptLines(items) };
  }

  private async loadItems(tx: TenantTransaction, transferId: string): Promise<ItemToReceive[]> {
    const rows = await tx.transferItem.findMany({
      where: { transferId },
      orderBy: { productId: 'asc' },
      select: { id: true, productId: true, quantity: true, receivedQuantity: true, unitCost: true },
    });
    return rows.map((r) => ({ ...r, unitCost: r.unitCost ? r.unitCost.toFixed(4) : null }));
  }

  /** A transfer is receivable by a member who operates the branch of its destination; otherwise it does not exist for them. */
  private async findReceivable(tx: TenantTransaction, id: string, allowed: string[] | null): Promise<void> {
    const found = await tx.transfer.findFirst({
      where: { id, ...(allowed ? { destinationWarehouse: { branchId: { in: allowed } } } : {}) },
      select: { id: true },
    });
    if (!found) throw transferNotFound();
  }

  /** `FOR UPDATE` on the transfer row, then the optimistic check against the `updatedAt` the client read. */
  private async lock(tx: TenantTransaction, id: string, companyId: string, expectedUpdatedAt: string): Promise<LockedTransfer> {
    const [row] = await tx.$queryRaw<{ number: string; status: string; updated_at: Date; destination_warehouse_id: string }[]>`
      SELECT number, status::text AS status, updated_at, destination_warehouse_id FROM transfers
      WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;
    if (!row) throw transferNotFound();
    if (row.updated_at.getTime() !== new Date(expectedUpdatedAt).getTime()) {
      throw new ConflictException({ code: 'TRANSFER_MODIFIED', message: 'The transfer changed since it was read' });
    }
    return { id, number: row.number, status: row.status as TransferStatus, destinationWarehouseId: row.destination_warehouse_id };
  }

  /** A write that moves stock for every line: Prisma's default 5 s would expire on a big transfer. */
  private writeTransaction<T>(fn: (tx: TenantTransaction) => Promise<T>): Promise<T> {
    return this.prisma.tenant.$transaction(fn, WRITE_TRANSACTION_OPTIONS);
  }

  private recordAudit(tx: TenantTransaction, entry: AuditEntry): Promise<void> {
    return this.audit.log(entry, tx as unknown as Prisma.TransactionClient);
  }

  private async assertCanReceive(): Promise<{ companyId: string; userId: string | null }> {
    const companyId = this.cls.get('companyId');
    if (!companyId) throw new Error('Transfer receipt outside a company context');
    const membershipId = this.cls.get('membershipId');
    const granted = membershipId ? await this.membership.permissions(membershipId) : new Set<string>();
    if (!granted.has('inventory.transfers.receive')) {
      throw new ForbiddenException({ code: 'NO_PERMISSION', message: 'You do not have permission for this action', details: { missing: ['inventory.transfers.receive'] } });
    }
    return { companyId, userId: this.cls.get('userId') ?? null };
  }

  /** Branches the member may operate; `null` means every branch. */
  private async operableBranches(): Promise<string[] | null> {
    const membershipId = this.cls.get('membershipId');
    return membershipId ? this.membership.operableBranchIds(membershipId) : [];
  }
}

function toReceiptLines(items: readonly ItemToReceive[]): ReceiptLine[] {
  return items.map((i) => ({ productId: i.productId, sent: i.quantity, received: i.receivedQuantity, unitCost: i.unitCost }));
}

/** Runs a domain rule and turns the `TransferError` it throws into a 422 with the same code. */
function asHttpRule<T>(rule: () => T): T {
  try {
    return rule();
  } catch (err) {
    throw err instanceof TransferError ? new UnprocessableEntityException({ code: err.code, message: err.message }) : err;
  }
}

function transferNotFound(): NotFoundException {
  return new NotFoundException({ code: 'TRANSFER_NOT_FOUND', message: 'Transfer not found' });
}

function invalidTransition(from: TransferStatus, event: string): UnprocessableEntityException {
  const err = new InvalidTransitionError(from, event);
  return new UnprocessableEntityException({ code: 'INVALID_TRANSITION', message: err.message, details: { from, event } });
}
