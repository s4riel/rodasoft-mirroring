import { Injectable } from '@nestjs/common';
import { type InvoiceCancellationItem, type InvoiceCancellationsResponse, type InvoiceStatus, SIAT_CANCELLATION_REASONS } from '@rodasoft/domain';
import { PrismaService } from '../../common/prisma/prisma.service';
import { cancellationErrors } from '../sales/sales/sale-cancellation.errors';
import { SaleCancellationService } from '../sales/sales/sale-cancellation.service';
import { SaleVisibilityService } from '../sales/sales/sale-visibility.service';
import type { InvoiceCancellationRequestDto } from './invoicing.dto';
import { invoicingErrors } from './invoicing.errors';

/**
 * Cancelling a valid invoice (HU-FAC-09, HU-FAC-10). Asking from an invoice is the same flow as asking from its sale (HU-VEN-14),
 * with the reason taken from the SIN table: the sale goes to `CANCELLATION_PENDING`, the invoice stays `VALID`, and nothing moves
 * until Management approves, which cancels in the SIAT first (`SaleCancellationService.approve`).
 */
@Injectable()
export class InvoiceCancellationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly visibility: SaleVisibilityService,
    private readonly sales: SaleCancellationService,
  ) {}

  async request(invoiceId: string, dto: InvoiceCancellationRequestDto): Promise<{ saleId: string; status: string }> {
    const scope = await this.visibility.resolve();
    const invoice = await this.prisma.tenant.invoice.findFirst({ where: { AND: [{ sale: scope.where }, { id: invoiceId }] }, select: { saleId: true, status: true } });
    if (!invoice) throw invoicingErrors.notFound();
    // only an invoice the SIAT accepted is cancelled from here; the others are voided with their sale
    if (invoice.status !== 'VALID') throw cancellationErrors.invoiceNotCancellable(invoice.status);
    if (!SIAT_CANCELLATION_REASONS.some((reason) => reason.code === dto.reasonCode)) throw invoicingErrors.invalidReasonCode();
    return this.sales.request(invoice.saleId, { reason: `SIN_${dto.reasonCode}`, comment: dto.comment });
  }

  /** The requests waiting for a decision, oldest first. */
  async pending(): Promise<InvoiceCancellationsResponse> {
    const scope = await this.visibility.resolve();
    const requests = await this.prisma.tenant.approvalRequest.findMany({
      where: { type: 'CANCELLATION', status: 'PENDING' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 200,
    });
    if (requests.length === 0) return { items: [] };

    const sales = await this.prisma.tenant.sale.findMany({
      where: { AND: [{ id: { in: requests.map((r) => r.subjectId) } }, scope.where] },
      select: { id: true, number: true, total: true, invoice: { select: { id: true, number: true, status: true, customerTaxName: true } } },
    });
    const bySale = new Map(sales.map((sale) => [sale.id, sale]));
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(requests.map((r) => r.requestedById))] } }, select: { id: true, name: true } });
    const names = new Map(users.map((user) => [user.id, user.name]));

    const items: InvoiceCancellationItem[] = [];
    for (const request of requests) {
      const sale = bySale.get(request.subjectId);
      if (!sale?.invoice) continue;
      items.push({
        saleId: sale.id,
        saleNumber: sale.number,
        invoiceId: sale.invoice.id,
        invoiceNumber: sale.invoice.number,
        invoiceStatus: sale.invoice.status as InvoiceStatus,
        customerName: sale.invoice.customerTaxName,
        total: sale.total.toFixed(2),
        reason: request.reason ?? '',
        comment: request.requesterComment ?? '',
        requestedBy: names.get(request.requestedById) ?? '',
        requestedAt: request.createdAt.toISOString(),
      });
    }
    return { items };
  }
}
