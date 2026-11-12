import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  clampPage,
  SALE_PAGE_SIZE_DEFAULT,
  SALE_PAGE_SIZE_MAX,
  saleItemsCount,
  type PaymentMethod,
  type SaleDetail,
  type SaleHistoryEntry,
  type SaleListResponse,
  type SaleStatus,
} from '@rodasoft/domain';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SettingsService } from '../../../common/settings/settings.service';
import { dayStart, nextDayStart } from '../../inventory/business-days';
import { posErrors } from '../pos/pos.errors';
import { LINE_SPEC_PRODUCT_SELECT, lineSpecsOf } from '../sales-line-spec';
import type { ListSalesQueryDto } from './sales-history.dto';
import { SaleReturnsQueryService } from '../returns/sale-returns-query.service';
import { SaleCancellationService } from './sale-cancellation.service';
import { SaleVisibilityService } from './sale-visibility.service';

/** The only audit action whose `after` reaches the history, and only its address. */
const EMAIL_ACTION = 'sales.receipt.email';

/**
 * The sales history (HU-VEN-12) and a sale's detail (HU-VEN-13). Read only. Who sees what is decided by
 * `SaleVisibilityService`; costs are never selected.
 */
@Injectable()
export class SalesHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly visibility: SaleVisibilityService,
    private readonly settings: SettingsService,
    private readonly cancellations: SaleCancellationService,
    private readonly returnQueries: SaleReturnsQueryService,
  ) {}

  async list(query: ListSalesQueryDto): Promise<SaleListResponse> {
    const scope = await this.visibility.resolve();
    const page = clampPage(query.page);
    const pageSize = Math.min(query.pageSize ?? SALE_PAGE_SIZE_DEFAULT, SALE_PAGE_SIZE_MAX);

    const and: Prisma.SaleWhereInput[] = [scope.where];
    if (query.status) and.push({ status: query.status });
    if (query.method) and.push({ payments: { some: { method: query.method } } });
    // everyone else only ever sees their own sales, so the cashier filter would change nothing
    if (query.cashierId && scope.all) and.push({ createdById: query.cashierId });
    if (query.q) {
      and.push({
        OR: [
          { number: { contains: query.q, mode: 'insensitive' } },
          { invoice: { customerTaxName: { contains: query.q, mode: 'insensitive' } } },
          { invoice: { customerDocumentNumber: { contains: query.q, mode: 'insensitive' } } },
        ],
      });
    }
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) createdAt.gte = dayStart(query.from);
    if (query.to) createdAt.lt = nextDayStart(query.to);
    if (createdAt.gte && createdAt.lt && createdAt.gte >= createdAt.lt) {
      throw new BadRequestException({ code: 'INVALID_FILTER', message: 'The date range is empty' });
    }
    if (createdAt.gte || createdAt.lt) and.push({ createdAt });
    const where: Prisma.SaleWhereInput = { AND: and };

    // one transaction, so a sale made in between cannot make the total and the page disagree
    const [total, rows] = await this.prisma.tenant.$transaction(async (tx) => [
      await tx.sale.count({ where }),
      await tx.sale.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          number: true,
          createdAt: true,
          total: true,
          status: true,
          invoice: { select: { customerTaxName: true, status: true } },
          items: { select: { quantity: true } },
          payments: { select: { method: true } },
        },
      }),
    ] as const);

    return {
      items: rows.map((sale) => ({
        id: sale.id,
        number: sale.number,
        customerName: sale.invoice?.customerTaxName ?? '',
        createdAt: sale.createdAt.toISOString(),
        itemsCount: saleItemsCount(sale.items),
        total: sale.total.toFixed(2),
        status: sale.status as SaleStatus,
        invoiceStatus: sale.invoice?.status ?? 'PENDING',
        methods: [...new Set(sale.payments.map((p) => p.method as PaymentMethod))],
      })),
      total,
      page,
      pageSize,
    };
  }

  async detail(saleId: string): Promise<SaleDetail> {
    const scope = await this.visibility.resolve();
    const sale = await this.prisma.tenant.sale.findFirst({
      where: { AND: [{ id: saleId }, scope.where] },
      include: {
        items: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          include: { product: { select: { manufacturerCode: true, name: true, ...LINE_SPEC_PRODUCT_SELECT } } },
        },
        payments: { orderBy: { id: 'asc' } },
        invoice: true,
        branch: { select: { name: true } },
        customer: { select: { email: true } },
        warehouse: { select: { name: true } },
        shift: { select: { register: { select: { name: true } } } },
        dispatch: { select: { order: { select: { id: true, number: true } } } },
      },
    });
    if (!sale || !sale.invoice) throw posErrors.saleNotFound();

    const [cashier, history, receiptFormat, cancellation, returns, specs] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: sale.createdById }, select: { name: true } }),
      this.history(sale.companyId, sale.id),
      this.settings.get('sales.receiptFormat'),
      this.cancellations.stateOf({ id: sale.id, status: sale.status as SaleStatus, createdAt: sale.createdAt, warehouse: sale.warehouse, shift: sale.shift, origin: sale.origin }),
      this.returnQueries.refsOfSale(sale.id),
      lineSpecsOf(this.prisma.tenant, sale.items.map((item) => item.product)),
    ]);

    return {
      id: sale.id,
      number: sale.number,
      createdAt: sale.createdAt.toISOString(),
      status: sale.status as SaleStatus,
      branch: { name: sale.branch.name },
      cashier: { name: cashier?.name ?? '' },
      order: sale.dispatch?.order ?? null,
      customer: {
        name: sale.invoice.customerTaxName,
        documentType: sale.invoice.customerDocumentType,
        documentNumber: sale.invoice.customerDocumentNumber,
        email: sale.customer?.email ?? null,
      },
      lines: sale.items.map((item) => ({
        code: item.product.manufacturerCode,
        name: item.product.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toFixed(2),
        lineTotal: item.lineTotal.toFixed(2),
        spec: specs.get(item.productId)!,
      })),
      subtotal: sale.subtotal.toFixed(2),
      discountType: sale.discountType,
      discountAmount: sale.discountAmount.toFixed(2),
      roundingAmount: sale.roundingAmount.toFixed(2),
      total: sale.total.toFixed(2),
      payments: sale.payments.map((p) => ({
        method: p.method as PaymentMethod,
        amount: p.amount.toFixed(2),
        change: p.change.toFixed(2),
        reference: p.reference,
        dueDate: p.dueDate ? p.dueDate.toISOString().slice(0, 10) : null,
      })),
      invoice: { status: sale.invoice.status, number: sale.invoice.number },
      history,
      cancellation,
      receiptFormat,
      returns,
      returnable: sale.status === 'COMPLETED' && (await this.returnQueries.hasReturnable(sale)),
    };
  }

  /** The audit trail of the sale, oldest first. Raw before/after JSON never leaves the server: only a whitelisted address. */
  private async history(companyId: string, saleId: string): Promise<SaleHistoryEntry[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: { companyId, entity: 'Sale', entityId: saleId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { action: true, createdAt: true, userId: true, after: true },
    });
    const userIds = [...new Set(rows.map((r) => r.userId).filter((id): id is string => !!id))];
    const users = userIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((row) => {
      const after = row.after as { email?: unknown } | null;
      return {
        action: row.action,
        at: row.createdAt.toISOString(),
        userName: row.userId ? (names.get(row.userId) ?? null) : null,
        email: row.action === EMAIL_ACTION && typeof after?.email === 'string' ? after.email : null,
      };
    });
  }
}
