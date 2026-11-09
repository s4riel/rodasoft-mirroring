import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  Decimal,
  dispatchableQuantity,
  InvalidTransitionError,
  isInvoicedStatus,
  effectiveQuoteStatus,
  isQuoteConvertible,
  laPazToday,
  orderTimeline,
  pendingQuantity,
  quoteMachine,
  releasableQuantity,
  SALES_DOCUMENT_PAGE_SIZE_DEFAULT,
  salesOrderMachine,
  type ConvertQuoteInput,
  type QuoteStatus,
  type SalesOrderDetail,
  type SalesOrderListQuery,
  type SalesOrderListResponse,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../../common/audit/audit.service';
import type { AppClsStore } from '../../../common/cls';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { PrismaService, type TenantTransaction } from '../../../common/prisma/prisma.service';
import { SettingsService } from '../../../common/settings/settings.service';
import { MembershipService } from '../../access/membership.service';
import { StockReservationService } from '../../inventory/stock-reservation.service';
import { nextDocumentNumber } from '../document-sequence';
import { quoteErrors } from '../quotes/quotes.errors';

const day = (date: Date): string => date.toISOString().slice(0, 10);
const asTx = (tx: TenantTransaction) => tx as unknown as Prisma.TransactionClient;

type DispatchWithInvoice = {
  items: { orderItemId: string; quantity: number }[];
  sale: { total: { toFixed(digits: number): string }; invoice: { status: string } | null } | null;
};

/** What the live invoices cover: a cancelled or rejected invoice leaves its pieces dispatched but not invoiced. */
function invoicedFigures(dispatches: readonly DispatchWithInvoice[]): { invoicedTotal: Decimal; invoicedByItem: Map<string, number> } {
  const invoiced = dispatches.filter((d) => d.sale && isInvoicedStatus(d.sale.invoice?.status));
  const invoicedTotal = invoiced.reduce((acc, d) => acc.add(Decimal.of(d.sale?.total.toFixed(2) ?? '0')), Decimal.zero());
  const invoicedByItem = new Map<string, number>();
  for (const d of invoiced) for (const i of d.items) invoicedByItem.set(i.orderItemId, (invoicedByItem.get(i.orderItemId) ?? 0) + i.quantity);
  return { invoicedTotal, invoicedByItem };
}

/**
 * Orders (HU-VEN-19): a quote becomes an order that holds its stock. Converting locks the quote row, so two calls on the same
 * quote run one after the other and the second finds it already `ACCEPTED`; the reservation is all or nothing and shares the
 * transaction with the order, so a short product leaves no order, no number gap and no reserved unit. Cancelling gives the
 * reserved units that were not dispatched back.
 */
@Injectable()
export class SalesOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly membership: MembershipService,
    private readonly reservations: StockReservationService,
    private readonly settings: SettingsService,
  ) {}

  /** `DRAFT | SENT → ACCEPTED` on the quote and a new `PED-000012` in `OPEN` with every line reserved in the warehouse. */
  async convert(quoteId: string, input: ConvertQuoteInput): Promise<SalesOrderDetail> {
    const companyId = this.requireCompany();
    const userId = this.requireUser();
    const today = laPazToday(new Date());

    const orderId = await this.prisma.tenant.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM quotes WHERE id = ${quoteId}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;
      if (!locked) throw quoteErrors.quoteNotFound();
      const quote = await tx.quote.findFirstOrThrow({ where: { id: quoteId }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
      const validUntil = day(quote.validUntil);
      if (!isQuoteConvertible(quote.status, validUntil, today)) {
        throw quoteErrors.notConvertible(effectiveQuoteStatus(quote.status, validUntil, today));
      }

      const warehouse = await tx.warehouse.findFirst({ where: { id: input.warehouseId }, select: { id: true, branchId: true, status: true } });
      const branchIds = await this.operableBranchIds();
      // decision #13: the stock comes from the order's own branch, so the warehouse must be one the user operates
      if (!warehouse || (branchIds && !branchIds.includes(warehouse.branchId))) throw quoteErrors.warehouseNotFound();
      if (warehouse.status !== 'ACTIVE') throw quoteErrors.warehouseInactive();

      const number = await nextDocumentNumber(tx, companyId, 'order');
      await this.reservations.reserve(
        tx,
        warehouse.id,
        quote.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      );

      const order = await tx.salesOrder.create({
        data: {
          companyId,
          number,
          customerId: quote.customerId,
          quoteId: quote.id,
          branchId: warehouse.branchId,
          warehouseId: warehouse.id,
          subtotal: quote.subtotal,
          discountType: quote.discountType,
          discountValue: quote.discountValue,
          discountAmount: quote.discountAmount,
          roundingAmount: quote.roundingAmount,
          total: quote.total,
          createdById: userId,
          items: {
            create: quote.items.map((item) => ({
              companyId,
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              lineTotal: item.lineTotal,
              sortOrder: item.sortOrder,
              reservedQuantity: item.quantity,
            })),
          },
        },
        select: { id: true },
      });

      const nextStatus = quoteMachine.next(quote.status as QuoteStatus, 'accept');
      await tx.quote.update({ where: { id: quote.id }, data: { status: nextStatus } });

      await this.audit.log(
        {
          action: 'sales.quote.accept',
          entity: 'Quote',
          entityId: quote.id,
          before: { status: quote.status },
          after: { status: nextStatus, orderNumber: number },
        },
        asTx(tx),
      );
      await this.audit.log(
        {
          action: 'sales.order.create',
          entity: 'SalesOrder',
          entityId: order.id,
          after: { number, quoteNumber: quote.number, warehouseId: warehouse.id, total: quote.total.toFixed(2), lines: quote.items.length },
        },
        asTx(tx),
      );
      await this.outbox.publish(
        'sales.order.created',
        { orderId: order.id, orderNumber: number, quoteId: quote.id, warehouseId: warehouse.id, total: quote.total.toFixed(2) },
        { tx, idempotencyKey: `order-created:${order.id}` },
      );
      return order.id;
    });
    return this.detail(orderId);
  }

  /** `OPEN | PARTIALLY_DISPATCHED → CANCELLED`, giving back the reserved units that were not dispatched. */
  async cancel(orderId: string, reason: string): Promise<SalesOrderDetail> {
    const companyId = this.requireCompany();
    await this.prisma.tenant.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM sales_orders WHERE id = ${orderId}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;
      if (!locked) throw quoteErrors.salesOrderNotFound();
      const order = await tx.salesOrder.findFirstOrThrow({ where: { id: orderId }, include: { items: true } });
      // an order of a branch the user does not operate is not theirs to cancel
      const branchIds = await this.operableBranchIds();
      if (branchIds && !branchIds.includes(order.branchId)) throw quoteErrors.salesOrderNotFound();

      let next;
      try {
        next = salesOrderMachine.next(order.status, 'cancel');
      } catch (err) {
        if (err instanceof InvalidTransitionError) throw quoteErrors.orderNotCancellable(order.status);
        throw err;
      }

      await this.reservations.release(
        tx,
        order.warehouseId,
        order.items.map((item) => ({ productId: item.productId, quantity: releasableQuantity(item) })),
      );
      for (const item of order.items) {
        await tx.salesOrderItem.update({ where: { id: item.id }, data: { reservedQuantity: item.dispatchedQuantity } });
      }
      await tx.salesOrder.update({ where: { id: orderId }, data: { status: next, cancelledAt: new Date() } });

      await this.audit.log(
        {
          action: 'sales.order.cancel',
          entity: 'SalesOrder',
          entityId: orderId,
          before: { status: order.status },
          after: { status: next, reason },
        },
        asTx(tx),
      );
      await this.outbox.publish(
        'sales.order.cancelled',
        { orderId, orderNumber: order.number, reason },
        { tx, idempotencyKey: `order-cancelled:${orderId}` },
      );
    });
    return this.detail(orderId);
  }

  async list(query: SalesOrderListQuery): Promise<SalesOrderListResponse> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? SALES_DOCUMENT_PAGE_SIZE_DEFAULT;
    const text = query.q?.trim();
    const branchIds = await this.operableBranchIds();
    const where: Prisma.SalesOrderWhereInput = {
      ...(branchIds ? { branchId: { in: branchIds } } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(text
        ? {
            OR: [
              { number: { contains: text, mode: 'insensitive' } },
              { quote: { number: { contains: text, mode: 'insensitive' } } },
              { customer: { name: { contains: text, mode: 'insensitive' } } },
              { customer: { documentNumber: { contains: text } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.tenant.salesOrder.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          number: true,
          status: true,
          total: true,
          createdAt: true,
          customer: { select: { name: true } },
          quote: { select: { number: true } },
          warehouse: { select: { name: true } },
        },
      }),
      this.prisma.tenant.salesOrder.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        number: row.number,
        customerName: row.customer.name,
        quoteNumber: row.quote?.number ?? null,
        warehouseName: row.warehouse.name,
        createdAt: row.createdAt.toISOString(),
        total: row.total.toFixed(2),
        status: row.status,
      })),
      total,
      page,
      pageSize,
    };
  }

  async detail(id: string): Promise<SalesOrderDetail> {
    const branchIds = await this.operableBranchIds();
    const order = await this.prisma.tenant.salesOrder.findFirst({
      where: { id, ...(branchIds ? { branchId: { in: branchIds } } : {}) },
      include: {
        customer: { select: { id: true, name: true, documentNumber: true } },
        quote: { select: { id: true, number: true } },
        branch: { select: { name: true } },
        warehouse: { select: { name: true } },
        items: { orderBy: { sortOrder: 'asc' }, include: { product: { select: { sku: true, manufacturerCode: true, name: true } } } },
        dispatches: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: { items: { select: { orderItemId: true, quantity: true } }, sale: { select: { number: true, total: true, invoice: { select: { status: true } } } } },
        },
      },
    });
    if (!order) throw quoteErrors.salesOrderNotFound();
    const userIds = [...new Set([order.createdById, ...order.dispatches.map((d) => d.createdById)])];
    const [users, partialDispatchAllowed, roundingMode, company] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
      this.settings.get('sales.allowPartialDispatch'),
      this.settings.get('sales.roundingMode'),
      this.prisma.company.findUniqueOrThrow({ where: { id: order.companyId }, select: { tradeName: true } }),
    ]);
    const userName = new Map(users.map((u) => [u.id, u.name]));
    const { invoicedTotal, invoicedByItem } = invoicedFigures(order.dispatches);
    const dispatchedAt = order.dispatches[0]?.createdAt.toISOString() ?? null;
    const completedAt = order.status === 'DISPATCHED' ? (order.dispatches.at(-1)?.createdAt.toISOString() ?? null) : null;
    return {
      id: order.id,
      number: order.number,
      status: order.status,
      customer: order.customer,
      quote: order.quote,
      company: company.tradeName,
      branchName: order.branch.name,
      warehouseName: order.warehouse.name,
      createdAt: order.createdAt.toISOString(),
      createdByName: userName.get(order.createdById) ?? null,
      cancelledAt: order.cancelledAt?.toISOString() ?? null,
      subtotal: order.subtotal.toFixed(2),
      discountAmount: order.discountAmount.toFixed(2),
      roundingAmount: order.roundingAmount.toFixed(2),
      total: order.total.toFixed(2),
      lines: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        sku: item.product.sku,
        code: item.product.manufacturerCode,
        name: item.product.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toFixed(2),
        lineTotal: item.lineTotal.toFixed(2),
        reservedQuantity: item.reservedQuantity,
        dispatchedQuantity: item.dispatchedQuantity,
        invoicedQuantity: invoicedByItem.get(item.id) ?? 0,
        pendingQuantity: pendingQuantity(item),
      })),
      cancellable: salesOrderMachine.can(order.status, 'cancel'),
      dispatches: order.dispatches.map((d) => ({
        id: d.id,
        number: d.number,
        createdAt: d.createdAt.toISOString(),
        createdByName: userName.get(d.createdById) ?? null,
        pieces: d.items.reduce((acc, i) => acc + i.quantity, 0),
        total: d.sale?.total.toFixed(2) ?? '0.00',
        saleId: d.saleId,
        saleNumber: d.sale?.number ?? null,
      })),
      invoicedTotal: invoicedTotal.toString(),
      timeline: orderTimeline({ status: order.status, createdAt: order.createdAt.toISOString(), dispatchedAt, completedAt }),
      dispatchable: salesOrderMachine.can(order.status, 'dispatchPartial') && order.items.some((item) => dispatchableQuantity(item) > 0),
      partialDispatchAllowed,
      roundingMode,
    };
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
