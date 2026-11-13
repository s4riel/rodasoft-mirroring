import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  Decimal,
  dispatchTotals,
  InvalidTransitionError,
  lineTotal,
  nextOrderEvent,
  normalizeDispatchRequest,
  SALE_REF_TYPE,
  salesOrderMachine,
  validateDispatch,
  type CreateDispatchInput,
  type DispatchAmounts,
  type DispatchLineInput,
  type DispatchableItem,
  type SalesOrderDetail,
  type SalesOrderStatus,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../../common/audit/audit.service';
import type { AppClsStore } from '../../../common/cls';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { PrismaService, type TenantTransaction } from '../../../common/prisma/prisma.service';
import { SettingsService } from '../../../common/settings/settings.service';
import { MembershipService } from '../../access/membership.service';
import { StockMovementService } from '../../inventory/stock-movement.service';
import { StockReservationService } from '../../inventory/stock-reservation.service';
import { nextDocumentNumber } from '../document-sequence';
import { invoiceDataOf } from '../pos/pos-invoice-data';
import { pointOfSaleOfSale, publishFirstIssueAttempt } from '../../../common/siat/invoice-intake';
import { quoteErrors } from '../quotes/quotes.errors';
import { dispatchErrors, dispatchIssueError } from './sales-order-dispatch.errors';
import { SalesOrdersService } from './sales-orders.service';

type LoadedOrder = Prisma.SalesOrderGetPayload<{ include: { items: true; customer: true } }>;
type DispatchLine = { item: LoadedOrder['items'][number]; quantity: number };
type OrderEvent = 'dispatchAll' | 'dispatchPartial';

type DispatchRecord = {
  order: LoadedOrder;
  lines: readonly DispatchLine[];
  totals: DispatchAmounts;
  nextStatus: SalesOrderStatus;
  saleId: string;
  saleNumber: string;
  dispatchId: string;
  dispatchNumber: string;
  completed: boolean;
};

/** Whether a repeated request asks for the same pieces as the dispatch the key already made (zeros and repeats aside). */
function sameDispatch(made: readonly DispatchLineInput[], asked: readonly DispatchLineInput[]): boolean {
  const a = normalizeDispatchRequest(made);
  const b = normalizeDispatchRequest(asked);
  const quantities = new Map(b.map((line) => [line.orderItemId, line.quantity]));
  return a.length === b.length && a.every((line) => quantities.get(line.orderItemId) === line.quantity);
}

/** Prisma `P2002` on the `(company_id, idempotency_key)` unique index of the dispatches. */
function isIdempotencyKeyConflict(err: unknown): boolean {
  const known = err as { code?: string; meta?: { target?: unknown } };
  return known?.code === 'P2002' && JSON.stringify(known.meta?.target ?? '').includes('idempotency_key');
}

const asTx = (tx: TenantTransaction) => tx as unknown as Prisma.TransactionClient;
const money = (value: { toFixed(digits: number): string }) => Decimal.of(value.toFixed(2));

type MoneyColumn = { toFixed(digits: number): string };

function amountsOf(row: { subtotal: MoneyColumn; discountAmount: MoneyColumn; roundingAmount: MoneyColumn; total: MoneyColumn }): DispatchAmounts {
  return {
    subtotal: money(row.subtotal),
    discountAmount: money(row.discountAmount),
    roundingAmount: money(row.roundingAmount),
    total: money(row.total),
  };
}

function dispatchableItemsOf(order: LoadedOrder): DispatchableItem[] {
  return order.items.map((item) => ({
    orderItemId: item.id,
    quantity: item.quantity,
    reservedQuantity: item.reservedQuantity,
    dispatchedQuantity: item.dispatchedQuantity,
  }));
}

/**
 * Dispatching an order in parts (HU-VEN-20). A dispatch turns reserved units into a sale and its `PENDING` invoice for exactly
 * those units, with no payment and no cash shift: collecting the money is not the POS's job here. Everything commits or
 * nothing does: the reservation, the `SALE` movements, the sale, the invoice, the dispatch, the order lines and its status.
 *
 * Lock order: the order row, then its lines, then the document sequences, then each product and its stock level by product id
 * (the same order as a POS sale and an order cancellation), so a dispatch, a cancellation and a sale never wait on each other
 * in a loop. Locking the order first also makes two dispatches of one order — or a dispatch and a cancellation — run one after
 * the other.
 */
@Injectable()
export class SalesOrderDispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsService,
    private readonly membership: MembershipService,
    private readonly reservations: StockReservationService,
    private readonly stock: StockMovementService,
    private readonly orders: SalesOrdersService,
  ) {}

  /**
   * Dispatches and invoices the chosen quantities. A repeated `idempotencyKey` of the same order returns the order as the first
   * call left it instead of dispatching again.
   */
  async dispatch(orderId: string, input: CreateDispatchInput, idempotencyKey: string): Promise<SalesOrderDetail> {
    const companyId = this.requireCompany();
    const userId = this.requireUser();

    try {
      await this.runDispatch(orderId, input, idempotencyKey, companyId, userId);
    } catch (err) {
      // two requests with one key for two different orders both pass the lookup; the unique index stops the second
      if (isIdempotencyKeyConflict(err)) throw dispatchErrors.idempotencyKeyReused();
      throw err;
    }
    return this.orders.detail(orderId);
  }

  private async runDispatch(orderId: string, input: CreateDispatchInput, idempotencyKey: string, companyId: string, userId: string): Promise<void> {
    await this.prisma.tenant.$transaction(async (tx) => {
      await this.lockOrderOfOperableBranch(tx, orderId, companyId);
      if (await this.isReplay(tx, orderId, input, idempotencyKey)) return;

      const order = await this.lockAndLoadOrder(tx, orderId, companyId);
      this.requireDispatchable(order.status);
      const items = dispatchableItemsOf(order);
      const allowPartial = await this.settings.get('sales.allowPartialDispatch', tx);
      const issues = validateDispatch(items, input.items, allowPartial);
      if (issues.length > 0) throw dispatchIssueError(issues);

      const request = normalizeDispatchRequest(input.items);
      const orderEvent = nextOrderEvent(items, request);
      const nextStatus = this.nextStatus(order.status, orderEvent);

      // the tax data is checked before any number is taken or any unit moves
      const invoice = invoiceDataOf(order.customer);
      const lines = this.resolveLines(order, request);
      const completed = orderEvent === 'dispatchAll';
      const totals = await this.totalsOf(tx, order, lines, completed);
      // what is left for the dispatch that completes the order can only be negative if earlier roundings drifted: stop, do not invoice it
      if (totals.total.isNegative()) throw dispatchErrors.totalInvalid();

      const dispatchNumber = await nextDocumentNumber(tx, companyId, 'dispatch');
      const saleNumber = await nextDocumentNumber(tx, companyId, 'sale');
      const saleId = await this.createSale(tx, order, lines, totals, { saleNumber, companyId, userId });
      await this.moveStock(tx, order, lines, { saleId, saleNumber, dispatchNumber });

      // no SIAT call here: the invoice is a PENDING record; the worker issues it after the commit (HU-FAC-01…10)
      const createdInvoice = await tx.invoice.create({
        select: { id: true },
        data: {
          companyId,
          saleId,
          branchId: order.branchId,
          pointOfSaleId: await pointOfSaleOfSale(tx, { branchId: order.branchId }),
          status: 'PENDING',
          total: totals.total.toString(),
          customerTaxName: invoice.name,
          customerDocumentType: invoice.documentType,
          customerDocumentNumber: invoice.documentNumber,
        },
      });
      await publishFirstIssueAttempt({ settings: this.settings, outbox: this.outbox }, tx, createdInvoice.id);

      const dispatch = await tx.dispatch.create({
        data: {
          companyId,
          orderId,
          number: dispatchNumber,
          saleId,
          idempotencyKey,
          createdById: userId,
          items: { create: lines.map(({ item, quantity }) => ({ companyId, orderItemId: item.id, quantity })) },
        },
        select: { id: true },
      });
      for (const { item, quantity } of lines) {
        await tx.salesOrderItem.update({ where: { id: item.id }, data: { dispatchedQuantity: { increment: quantity } } });
      }
      await tx.salesOrder.update({ where: { id: orderId }, data: { status: nextStatus } });

      await this.recordDispatch(tx, { order, lines, totals, nextStatus, saleId, saleNumber, dispatchId: dispatch.id, dispatchNumber, completed });
    });
  }

  /** Locks the order row (first in the lock order) and hides an order of a branch the user does not operate. */
  private async lockOrderOfOperableBranch(tx: TenantTransaction, orderId: string, companyId: string): Promise<void> {
    const [locked] = await tx.$queryRaw<{ id: string; branchId: string }[]>`
      SELECT id, branch_id AS "branchId" FROM sales_orders WHERE id = ${orderId}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;
    if (!locked) throw quoteErrors.salesOrderNotFound();
    const branchIds = await this.operableBranchIds();
    if (branchIds && !branchIds.includes(locked.branchId)) throw quoteErrors.salesOrderNotFound();
  }

  /** True when the key already made this very dispatch; throws when the key belongs to another order or another request. */
  private async isReplay(tx: TenantTransaction, orderId: string, input: CreateDispatchInput, idempotencyKey: string): Promise<boolean> {
    const previousCall = await tx.dispatch.findFirst({
      where: { idempotencyKey },
      select: { orderId: true, items: { select: { orderItemId: true, quantity: true } } },
    });
    if (!previousCall) return false;
    // the same key means the same request: other quantities are a different request, not a replay
    if (previousCall.orderId !== orderId || !sameDispatch(previousCall.items, input.items)) throw dispatchErrors.idempotencyKeyReused();
    return true;
  }

  private async lockAndLoadOrder(tx: TenantTransaction, orderId: string, companyId: string): Promise<LoadedOrder> {
    await tx.$queryRaw`SELECT id FROM sales_order_items WHERE order_id = ${orderId}::uuid AND company_id = ${companyId}::uuid ORDER BY id FOR UPDATE`;
    return tx.salesOrder.findFirstOrThrow({
      where: { id: orderId },
      include: { items: { orderBy: { sortOrder: 'asc' } }, customer: true },
    });
  }

  private nextStatus(status: SalesOrderStatus, orderEvent: OrderEvent): SalesOrderStatus {
    try {
      return salesOrderMachine.next(status, orderEvent);
    } catch (err) {
      if (err instanceof InvalidTransitionError) throw dispatchErrors.notDispatchable(status);
      throw err;
    }
  }

  private resolveLines(order: LoadedOrder, request: readonly DispatchLineInput[]): DispatchLine[] {
    const itemById = new Map(order.items.map((item) => [item.id, item]));
    return request.map((line) => {
      const item = itemById.get(line.orderItemId);
      if (!item) throw dispatchErrors.itemNotFound(line.orderItemId);
      return { item, quantity: line.quantity };
    });
  }

  private async totalsOf(tx: TenantTransaction, order: LoadedOrder, lines: readonly DispatchLine[], completesOrder: boolean): Promise<DispatchAmounts> {
    const earlier = await tx.dispatch.findMany({
      where: { orderId: order.id },
      select: { sale: { select: { subtotal: true, discountAmount: true, roundingAmount: true, total: true } } },
    });
    const roundingMode = await this.settings.get('sales.roundingMode', tx);
    return dispatchTotals({
      order: amountsOf(order),
      previous: earlier.flatMap((row) => (row.sale ? [amountsOf(row.sale)] : [])),
      lines: lines.map(({ item, quantity }) => ({ unitPrice: item.unitPrice.toFixed(2), quantity })),
      completesOrder,
      roundingMode,
    });
  }

  private async createSale(
    tx: TenantTransaction,
    order: LoadedOrder,
    lines: readonly DispatchLine[],
    totals: DispatchAmounts,
    ids: { saleNumber: string; companyId: string; userId: string },
  ): Promise<string> {
    const { saleNumber, companyId, userId } = ids;
    const sale = await tx.sale.create({
      data: {
        companyId,
        number: saleNumber,
        origin: 'ORDER',
        customerId: order.customerId,
        branchId: order.branchId,
        warehouseId: order.warehouseId,
        status: 'COMPLETED',
        subtotal: totals.subtotal.toString(),
        // the customer discount of the order is copied, as the POS copies it from the customer
        discountType: order.discountType,
        // a percent stays the customer's percent; a fixed amount is the share this sale carries, so value and amount agree
        discountValue: order.discountType === 'AMOUNT' ? totals.discountAmount.toString() : order.discountValue.toFixed(2),
        discountAmount: totals.discountAmount.toString(),
        roundingAmount: totals.roundingAmount.toString(),
        total: totals.total.toString(),
        createdById: userId,
        items: {
          create: lines.map(({ item, quantity }, index) => ({
            companyId,
            productId: item.productId,
            quantity,
            unitPrice: item.unitPrice.toFixed(2),
            lineTotal: lineTotal(item.unitPrice.toFixed(2), quantity).toString(),
            sortOrder: index,
          })),
        },
      },
      select: { id: true },
    });
    return sale.id;
  }

  /** Reserved units leave first, then the movement writes the same units out: `quantity − reserved` does not move for others. */
  private async moveStock(
    tx: TenantTransaction,
    order: LoadedOrder,
    lines: readonly DispatchLine[],
    refs: { saleId: string; saleNumber: string; dispatchNumber: string },
  ): Promise<void> {
    const byProduct = [...lines].sort((a, b) => (a.item.productId < b.item.productId ? -1 : a.item.productId > b.item.productId ? 1 : 0));
    for (const { item, quantity } of byProduct) {
      await this.reservations.consume(tx, order.warehouseId, [{ productId: item.productId, quantity }]);
      await this.stock.apply(tx, {
        productId: item.productId,
        warehouseId: order.warehouseId,
        type: 'SALE',
        quantity: -quantity,
        reason: `Despacho ${refs.dispatchNumber} · Pedido ${order.number}`,
        refType: SALE_REF_TYPE,
        refId: refs.saleId,
        refNumber: refs.saleNumber,
      });
    }
  }

  /** The two audit entries and the two outbox events of a dispatch, in the transaction of the dispatch. */
  private async recordDispatch(tx: TenantTransaction, d: DispatchRecord): Promise<void> {
    const { order, lines } = d;
    const total = d.totals.total.toString();
    await this.audit.log(
      {
        action: 'sales.order.dispatch',
        entity: 'SalesOrder',
        entityId: order.id,
        before: { status: order.status },
        after: {
          status: d.nextStatus,
          dispatchNumber: d.dispatchNumber,
          saleNumber: d.saleNumber,
          pieces: lines.reduce((acc, line) => acc + line.quantity, 0),
          total,
          lines: lines.map(({ item, quantity }) => ({ productId: item.productId, quantity })),
        },
      },
      asTx(tx),
    );
    await this.audit.log(
      {
        action: 'sales.sale.complete',
        entity: 'Sale',
        entityId: d.saleId,
        after: { number: d.saleNumber, origin: 'ORDER', orderNumber: order.number, dispatchNumber: d.dispatchNumber, total },
      },
      asTx(tx),
    );
    await this.outbox.publish(
      'sale.completed',
      {
        saleId: d.saleId,
        number: d.saleNumber,
        refType: SALE_REF_TYPE,
        total,
        shiftId: null,
        branchId: order.branchId,
        origin: 'ORDER',
        orderId: order.id,
        dispatchId: d.dispatchId,
      },
      { tx, idempotencyKey: `sale-completed:${d.saleId}` },
    );
    await this.outbox.publish(
      'sales.order.dispatched',
      {
        orderId: order.id,
        orderNumber: order.number,
        dispatchId: d.dispatchId,
        dispatchNumber: d.dispatchNumber,
        saleId: d.saleId,
        saleNumber: d.saleNumber,
        total,
        completed: d.completed,
      },
      { tx, idempotencyKey: `order-dispatched:${d.dispatchId}` },
    );
  }

  /** `OPEN` and `PARTIALLY_DISPATCHED` orders dispatch; a fully dispatched or cancelled one does not. */
  private requireDispatchable(status: SalesOrderStatus): void {
    if (!salesOrderMachine.can(status, 'dispatchPartial')) throw dispatchErrors.notDispatchable(status);
  }

  private async operableBranchIds(): Promise<string[] | null> {
    const membershipId = this.cls.get('membershipId');
    return membershipId ? this.membership.operableBranchIds(membershipId) : [];
  }

  private requireCompany(): string {
    const id = this.cls.get('companyId');
    if (!id) throw quoteErrors.salesOrderNotFound();
    return id;
  }

  private requireUser(): string {
    const id = this.cls.get('userId');
    if (!id) throw quoteErrors.salesOrderNotFound();
    return id;
  }
}
