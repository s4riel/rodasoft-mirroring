import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  cancellationWindowEndsAt,
  formatSaleNumber,
  laPazToday,
  parseSalesDocumentNumber,
  returnableQuantity,
  returnTimeline,
  SALES_DOCUMENT_PAGE_SIZE_DEFAULT,
  type InvoiceStatus,
  type RefundMethod,
  type ReturnableSale,
  type ReturnCondition,
  type ReturnReason,
  type SaleReturnDetail,
  type SaleReturnList,
  type SaleReturnRef,
  type SaleReturnStatus,
  type SaleReturnSummary,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../../../common/cls';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SettingsService } from '../../../common/settings/settings.service';
import { MembershipService } from '../../access/membership.service';
import { returnErrors } from './sale-returns.errors';
import type { ListReturnsQueryDto } from './sale-returns.dto';

const money = (value: { toFixed(digits: number): string }) => value.toFixed(2);

const SUMMARY_INCLUDE = {
  sale: { select: { number: true, customerId: true, invoice: { select: { customerTaxName: true, customerDocumentNumber: true } } } },
  items: { select: { quantity: true, condition: true } },
  creditNote: { select: { status: true } },
} satisfies Prisma.SaleReturnInclude;
type SummaryRow = Prisma.SaleReturnGetPayload<{ include: typeof SUMMARY_INCLUDE }>;

/** Reads of the returns: the list with its KPIs, the sale lookup of the form and the detail. Writes are in `SaleReturnsService`. */
@Injectable()
export class SaleReturnsQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly settings: SettingsService,
    private readonly membership: MembershipService,
  ) {}

  /** The returns newest first with the four KPIs of VP-20 (this month: created in the La Paz month, rejected ones not counted). */
  async list(query: ListReturnsQueryDto): Promise<SaleReturnList> {
    const scope = await this.scope();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? SALES_DOCUMENT_PAGE_SIZE_DEFAULT;
    const where: Prisma.SaleReturnWhereInput = { AND: [scope, query.status ? { status: query.status } : {}] };
    const monthStart = new Date(`${laPazToday(new Date()).slice(0, 7)}-01T00:00:00-04:00`);
    const month: Prisma.SaleReturnWhereInput = { AND: [scope, { status: 'APPROVED', createdAt: { gte: monthStart } }] };

    const [rows, total, sum, monthAgg, pendingCount, scrap] = await Promise.all([
      this.prisma.tenant.saleReturn.findMany({
        where,
        include: SUMMARY_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.tenant.saleReturn.count({ where }),
      this.prisma.tenant.saleReturn.aggregate({ where, _sum: { total: true } }),
      this.prisma.tenant.saleReturn.aggregate({ where: month, _sum: { total: true }, _count: true }),
      this.prisma.tenant.saleReturn.count({ where: { AND: [scope, { status: 'PENDING_APPROVAL' }] } }),
      this.prisma.tenant.saleReturnItem.aggregate({ where: { condition: 'SCRAP', return: month }, _sum: { quantity: true } }),
    ]);

    return {
      items: rows.map((row) => this.summaryOf(row)),
      total,
      page,
      pageSize,
      totalAmount: money(sum._sum.total ?? new Prisma.Decimal(0)),
      kpis: {
        monthCount: monthAgg._count,
        monthAmount: money(monthAgg._sum.total ?? new Prisma.Decimal(0)),
        pendingCount,
        scrapPieces: scrap._sum.quantity ?? 0,
      },
    };
  }

  /** The newest sale whose number or customer document matches `q`, with what of it can still come back. */
  async lookup(q: string): Promise<ReturnableSale> {
    const text = q.trim();
    if (text === '') throw returnErrors.saleNotFound();
    const branchIds = await this.operableBranchIds();
    const sequence = /^\d+$/.test(text) ? Number(text) : parseSalesDocumentNumber('sale', text.toUpperCase());
    const number = sequence !== null ? formatSaleNumber(sequence) : text.toUpperCase();
    const sale = await this.prisma.tenant.sale.findFirst({
      where: {
        AND: [
          branchIds ? { branchId: { in: branchIds } } : {},
          { OR: [{ number }, { invoice: { customerDocumentNumber: text } }] },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        invoice: true,
        items: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], include: { product: { select: { name: true, sku: true } } } },
      },
    });
    if (!sale || !sale.invoice) throw returnErrors.saleNotFound();

    const returned = await this.prisma.tenant.saleReturnItem.groupBy({
      by: ['saleItemId'],
      where: { saleItem: { saleId: sale.id }, return: { status: { not: 'REJECTED' } } },
      _sum: { quantity: true },
    });
    const returnedBy = new Map(returned.map((row) => [row.saleItemId, row._sum.quantity ?? 0]));
    const [windowDays, approvalLimit, refunded] = await Promise.all([
      this.settings.get('sales.returnWindowDays'),
      this.settings.get('sales.returnApprovalLimit'),
      this.prisma.tenant.saleReturn.aggregate({ where: { saleId: sale.id, status: { not: 'REJECTED' } }, _sum: { total: true } }),
    ]);
    const hasCustomer = sale.customerId !== null;

    return {
      saleId: sale.id,
      saleNumber: sale.number,
      customerName: hasCustomer ? sale.invoice.customerTaxName : null,
      customerDocumentNumber: hasCustomer ? sale.invoice.customerDocumentNumber : null,
      soldAt: sale.createdAt.toISOString(),
      total: money(sale.total),
      subtotal: money(sale.subtotal),
      hasCustomer,
      invoiceNumber: sale.invoice.number,
      refunded: money(refunded._sum.total ?? new Prisma.Decimal(0)),
      approvalLimit,
      windowEndsAt: cancellationWindowEndsAt(sale.createdAt, windowDays)?.toISOString() ?? null,
      lines: sale.items.map((item) => {
        const done = returnedBy.get(item.id) ?? 0;
        return {
          saleItemId: item.id,
          productId: item.productId,
          productName: item.product.name,
          sku: item.product.sku,
          unitPrice: money(item.unitPrice),
          sold: item.quantity,
          returned: done,
          returnable: returnableQuantity(item.quantity, done),
        };
      }),
    };
  }

  async detail(returnId: string): Promise<SaleReturnDetail> {
    const scope = await this.scope();
    const row = await this.prisma.tenant.saleReturn.findFirst({
      where: { AND: [{ id: returnId }, scope] },
      include: {
        ...SUMMARY_INCLUDE,
        items: { orderBy: { id: 'asc' }, include: { saleItem: { include: { product: { select: { name: true, sku: true } } } } } },
        sale: { select: { number: true, customerId: true, invoice: { select: { number: true, customerTaxName: true, customerDocumentNumber: true } } } },
      },
    });
    if (!row) throw returnErrors.returnNotFound();

    const [request, audit] = await Promise.all([
      this.prisma.tenant.approvalRequest.findFirst({ where: { type: 'RETURN', subjectId: row.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      this.prisma.auditLog.findMany({
        where: { companyId: row.companyId, entity: 'SaleReturn', entityId: row.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { action: true, createdAt: true, userId: true },
      }),
    ]);
    const names = await this.userNames([row.createdById, request?.decidedById ?? null, request?.requestedById ?? null, ...audit.map((entry) => entry.userId)]);
    const summary = this.summaryOf(row);
    const createdAt = row.createdAt.toISOString();
    const approvedAt = row.approvedAt?.toISOString() ?? null;
    const status = row.status as SaleReturnStatus;
    const decided = request && (request.status === 'APPROVED' || request.status === 'REJECTED') && request.decidedAt;

    return {
      ...summary,
      reason: row.reason as ReturnReason,
      comment: row.comment,
      refundMethod: row.refundMethod as RefundMethod,
      refundReference: row.refundReference,
      customerDocumentNumber: this.hasCustomer(row) ? row.sale.invoice?.customerDocumentNumber ?? null : null,
      createdByName: names.get(row.createdById) ?? null,
      approvedAt,
      scrapPieces: row.items.filter((item) => item.condition === 'SCRAP').reduce((acc, item) => acc + item.quantity, 0),
      invoiceNumber: row.sale.invoice?.number ?? null,
      items: row.items.map((item) => ({
        saleItemId: item.saleItemId,
        productId: item.saleItem.productId,
        productName: item.saleItem.product.name,
        sku: item.saleItem.product.sku,
        quantity: item.quantity,
        condition: item.condition as ReturnCondition,
        refundAmount: money(item.refundAmount),
      })),
      timeline: returnTimeline({ status, createdAt, approvedAt, creditNoteStatus: summary.creditNoteStatus }),
      audit: audit.map((entry) => ({ action: entry.action, at: entry.createdAt.toISOString(), userName: entry.userId ? (names.get(entry.userId) ?? null) : null })),
      approval:
        request && request.status === 'PENDING'
          ? { id: request.id, requestedBy: names.get(request.requestedById) ?? '', requestedAt: request.createdAt.toISOString(), comment: request.requesterComment }
          : null,
      decision: decided
        ? {
            status: request.status as 'APPROVED' | 'REJECTED',
            decidedBy: (request.decidedById && names.get(request.decidedById)) || '',
            decidedAt: (request.decidedAt as Date).toISOString(),
            comment: request.comment ?? '',
          }
        : null,
    };
  }

  /** The returns of a sale, newest first, for the sale detail. */
  async refsOfSale(saleId: string): Promise<SaleReturnRef[]> {
    const rows = await this.prisma.tenant.saleReturn.findMany({
      where: { saleId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, number: true, status: true, total: true, createdAt: true },
    });
    return rows.map((row) => ({ id: row.id, number: row.number, status: row.status as SaleReturnStatus, total: money(row.total), createdAt: row.createdAt.toISOString() }));
  }

  /** Whether some unit of the sale can still come back. */
  async hasReturnable(sale: { id: string; items: { id: string; quantity: number }[] }): Promise<boolean> {
    const returned = await this.prisma.tenant.saleReturnItem.groupBy({
      by: ['saleItemId'],
      where: { saleItem: { saleId: sale.id }, return: { status: { not: 'REJECTED' } } },
      _sum: { quantity: true },
    });
    const returnedBy = new Map(returned.map((row) => [row.saleItemId, row._sum.quantity ?? 0]));
    return sale.items.some((item) => returnableQuantity(item.quantity, returnedBy.get(item.id) ?? 0) > 0);
  }

  private hasCustomer(row: SummaryRow): boolean {
    // a sale without a customer was invoiced to the final consumer: the returns show no customer for it
    return row.sale.customerId !== null;
  }

  private summaryOf(row: SummaryRow): SaleReturnSummary {
    return {
      id: row.id,
      number: row.number,
      saleId: row.saleId,
      saleNumber: row.sale.number,
      customerName: this.hasCustomer(row) ? (row.sale.invoice?.customerTaxName ?? null) : null,
      pieces: row.items.reduce((acc, item) => acc + item.quantity, 0),
      total: money(row.total),
      status: row.status as SaleReturnStatus,
      creditNoteStatus: (row.creditNote?.status ?? null) as InvoiceStatus | null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** The returns of the branches the caller operates (every branch for a caller without a restriction). */
  private async scope(): Promise<Prisma.SaleReturnWhereInput> {
    const branchIds = await this.operableBranchIds();
    return branchIds ? { sale: { branchId: { in: branchIds } } } : {};
  }

  private async operableBranchIds(): Promise<string[] | null> {
    const membershipId = this.cls.get('membershipId');
    return membershipId ? this.membership.operableBranchIds(membershipId) : [];
  }

  private async userNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    const users = unique.length ? await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } }) : [];
    return new Map(users.map((user) => [user.id, user.name]));
  }
}
