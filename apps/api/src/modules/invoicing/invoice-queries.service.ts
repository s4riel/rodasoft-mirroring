import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  clampPage,
  Decimal,
  INVOICE_LEGEND_DEFAULT,
  INVOICE_PAGE_SIZE_DEFAULT,
  INVOICE_PAGE_SIZE_MAX,
  invoiceActions,
  laPazToday,
  type InvoiceDetail,
  type InvoiceListItem,
  type InvoiceListResponse,
  type InvoiceStatus,
  type InvoicingStatus,
  type SiatConnectionStatus,
} from '@rodasoft/domain';
import { EnvironmentCode, siatQrUrl } from '@rodasoft/siat';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../../common/cls';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MembershipService } from '../access/membership.service';
import { dayStart, nextDayStart } from '../inventory/business-days';
import { SaleVisibilityService } from '../sales/sales/sale-visibility.service';
import { invoicingErrors } from './invoicing.errors';
import type { ListInvoicesQueryDto } from './invoicing.dto';

const ISSUED_STATUSES: InvoiceStatus[] = ['VALID', 'CANCELLATION_PENDING'];

const LIST_SELECT = {
  id: true,
  number: true,
  status: true,
  saleId: true,
  total: true,
  customerTaxName: true,
  customerDocumentNumber: true,
  issuedAt: true,
  createdAt: true,
  branchId: true,
  rejectionMessage: true,
  sale: { select: { number: true } },
} satisfies Prisma.InvoiceSelect;

/** What the invoicing screens read (HU-FAC-01…04): the day indicators, the list and one invoice. Read only. */
@Injectable()
export class InvoiceQueriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly visibility: SaleVisibilityService,
    private readonly membership: MembershipService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  /** Own sales unless the caller may see every sale (the same rule as the sales history). */
  private async scope(): Promise<Prisma.InvoiceWhereInput> {
    const { where } = await this.visibility.resolve();
    return { sale: where };
  }

  private async permissions(): Promise<Set<string>> {
    const membershipId = this.cls.get('membershipId');
    return membershipId ? this.membership.permissions(membershipId) : new Set<string>();
  }

  /** `GET invoicing/status`: the SIAT connection and how many invoices wait for a person. */
  async status(): Promise<InvoicingStatus> {
    const scope = await this.scope();
    const companyId = this.cls.get('companyId') ?? '';
    const [settings, notIssued, rejected] = await Promise.all([
      this.prisma.siatSettings.findUnique({ where: { companyId }, select: { connectionStatus: true, connectionCheckedAt: true } }),
      this.prisma.tenant.invoice.count({ where: { AND: [scope, { status: 'PENDING' }] } }),
      this.prisma.tenant.invoice.count({ where: { AND: [scope, { status: 'REJECTED' }] } }),
    ]);
    return {
      connection: (settings?.connectionStatus ?? 'UNKNOWN') as SiatConnectionStatus,
      checkedAt: settings?.connectionCheckedAt?.toISOString() ?? null,
      notIssued,
      rejected,
    };
  }

  async list(query: ListInvoicesQueryDto): Promise<InvoiceListResponse> {
    const scope = await this.scope();
    const page = clampPage(query.page);
    const pageSize = Math.min(query.pageSize ?? INVOICE_PAGE_SIZE_DEFAULT, INVOICE_PAGE_SIZE_MAX);

    const and: Prisma.InvoiceWhereInput[] = [scope];
    if (query.status) and.push({ status: query.status });
    if (query.branchId) and.push({ branchId: query.branchId });
    if (query.q) {
      const number = /^\d{1,9}$/.test(query.q) ? Number(query.q) : null;
      and.push({
        OR: [
          ...(number !== null ? [{ number }] : []),
          { sale: { number: { contains: query.q, mode: 'insensitive' as const } } },
          { customerTaxName: { contains: query.q, mode: 'insensitive' as const } },
          { customerDocumentNumber: { contains: query.q, mode: 'insensitive' as const } },
        ],
      });
    }
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) createdAt.gte = dayStart(query.from);
    if (query.to) createdAt.lt = nextDayStart(query.to);
    if (createdAt.gte && createdAt.lt && createdAt.gte >= createdAt.lt) throw invoicingErrors.invalidFilter('The date range is empty');
    if (createdAt.gte || createdAt.lt) and.push({ createdAt });
    const where: Prisma.InvoiceWhereInput = { AND: and };

    const today = laPazToday(new Date());
    const issuedToday: Prisma.InvoiceWhereInput = { AND: [scope, { status: { in: ISSUED_STATUSES } }, { issuedAt: { gte: dayStart(today), lt: nextDayStart(today) } }] };

    // one transaction, so an invoice issued in between cannot make the total and the page disagree
    const [permissions, total, rows, filtered, issuedTodayAgg, notIssued, rejected, cancellationsPending] = await Promise.all([
      this.permissions(),
      this.prisma.tenant.invoice.count({ where }),
      this.prisma.tenant.invoice.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: LIST_SELECT,
      }),
      this.prisma.tenant.invoice.aggregate({ where, _sum: { total: true } }),
      this.prisma.tenant.invoice.aggregate({ where: issuedToday, _sum: { total: true }, _count: true }),
      this.prisma.tenant.invoice.count({ where: { AND: [scope, { status: 'PENDING' }] } }),
      this.prisma.tenant.invoice.count({ where: { AND: [scope, { status: 'REJECTED' }] } }),
      this.prisma.tenant.invoice.count({ where: { AND: [scope, { status: 'CANCELLATION_PENDING' }] } }),
    ]);

    return {
      items: rows.map((row) => this.item(row, permissions)),
      total,
      page,
      pageSize,
      totalAmount: Decimal.of((filtered._sum.total ?? 0).toString()).toString(),
      kpis: {
        issuedToday: { count: issuedTodayAgg._count, total: Decimal.of((issuedTodayAgg._sum.total ?? 0).toString()).toString() },
        notIssued,
        rejected,
        cancellationsPending,
      },
    };
  }

  async detail(invoiceId: string): Promise<InvoiceDetail> {
    const scope = await this.scope();
    const invoice = await this.prisma.tenant.invoice.findFirst({
      where: { AND: [scope, { id: invoiceId }] },
      include: {
        sale: {
          select: {
            number: true,
            items: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { quantity: true, unitPrice: true, lineTotal: true, product: { select: { name: true, manufacturerCode: true } } } },
            payments: { orderBy: { id: 'asc' }, select: { method: true, amount: true } },
          },
        },
        company: { select: { nit: true } },
        pointOfSale: { select: { code: true, name: true } },
        branch: { select: { name: true } },
      },
    });
    if (!invoice) throw invoicingErrors.notFound();

    const [permissions, settings, audit, pendingException, pendingCancellation] = await Promise.all([
      this.permissions(),
      this.prisma.siatSettings.findUnique({ where: { companyId: invoice.companyId }, select: { environment: true, modality: true } }),
      this.prisma.auditLog.findMany({
        where: { companyId: invoice.companyId, entity: 'Invoice', entityId: invoice.id },
        orderBy: { id: 'asc' },
        select: { action: true, createdAt: true, userId: true, after: true },
      }),
      this.prisma.tenant.approvalRequest.count({ where: { type: 'NIT_EXCEPTION', subjectId: invoice.id, status: 'PENDING' } }),
      this.prisma.tenant.approvalRequest.findFirst({
        where: { type: 'CANCELLATION', subjectId: invoice.saleId, status: 'PENDING' },
        select: { requestedById: true, createdAt: true },
      }),
    ]);
    const userIds = [...new Set([...audit.map((entry) => entry.userId), pendingCancellation?.requestedById ?? null].filter((id): id is string => id !== null))];
    const users = userIds.length > 0 ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
    const names = new Map(users.map((user) => [user.id, user.name]));

    const environment = settings?.environment === 'PRODUCTION' ? EnvironmentCode.Production : EnvironmentCode.Test;
    return {
      ...this.item({ ...invoice, sale: { number: invoice.sale.number } }, permissions),
      cuf: invoice.cuf,
      siatReceptionCode: invoice.siatReceptionCode,
      rejectionCode: invoice.rejectionCode,
      customerDocumentType: invoice.customerDocumentType,
      customerComplement: invoice.customerComplement,
      nitVerifiedAt: invoice.nitVerifiedAt?.toISOString() ?? null,
      nitException: invoice.nitException,
      pendingNitException: pendingException > 0,
      modality: settings?.modality ?? null,
      pointOfSale: invoice.pointOfSale ? `${invoice.pointOfSale.code} · ${invoice.pointOfSale.name}` : null,
      legend: INVOICE_LEGEND_DEFAULT,
      verificationUrl:
        invoice.cuf && invoice.number !== null ? siatQrUrl({ environment, nit: invoice.company.nit, cuf: invoice.cuf, number: invoice.number }) : null,
      branchName: invoice.branch.name,
      pendingCancellation: pendingCancellation
        ? { requestedBy: (pendingCancellation.requestedById && names.get(pendingCancellation.requestedById)) || null, requestedAt: pendingCancellation.createdAt.toISOString() }
        : null,
      lines: invoice.sale.items.map((line) => ({
        code: line.product.manufacturerCode,
        description: line.product.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice.toFixed(2),
        total: line.lineTotal.toFixed(2),
      })),
      payments: invoice.sale.payments.map((payment) => ({ method: payment.method, amount: payment.amount.toFixed(2) })),
      history: audit.map((entry) => ({
        at: entry.createdAt.toISOString(),
        action: entry.action,
        actor: entry.userId ? (names.get(entry.userId) ?? null) : null,
        detail: describeAudit(entry.after),
      })),
      cancellationReasonCode: invoice.cancellationReasonCode,
      cancelledAt: invoice.cancelledAt?.toISOString() ?? null,
      lastError: invoice.lastError,
    };
  }

  private item(
    row: {
      id: string;
      number: number | null;
      status: string;
      saleId: string;
      total: Prisma.Decimal;
      customerTaxName: string;
      customerDocumentNumber: string;
      issuedAt: Date | null;
      createdAt: Date;
      branchId: string;
      rejectionMessage: string | null;
      sale: { number: string };
    },
    permissions: Set<string>,
  ): InvoiceListItem {
    const status = row.status as InvoiceStatus;
    return {
      id: row.id,
      number: row.number,
      status,
      saleId: row.saleId,
      saleNumber: row.sale.number,
      customerName: row.customerTaxName,
      customerDocumentNumber: row.customerDocumentNumber,
      total: row.total.toFixed(2),
      issuedAt: row.issuedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      branchId: row.branchId,
      rejectionMessage: row.rejectionMessage,
      actions: invoiceActions(status, permissions),
    };
  }
}

/** The one-line detail of a history row: the SIAT code or message that matters, never raw JSON. */
function describeAudit(after: unknown): string | null {
  if (typeof after !== 'object' || after === null) return null;
  const record = after as Record<string, unknown>;
  const message = record['message'] ?? record['error'] ?? record['receptionCode'];
  return typeof message === 'string' ? message : null;
}
