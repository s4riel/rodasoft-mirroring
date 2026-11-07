import { Injectable } from '@nestjs/common';
import { receiptShareText, type ReprintReceiptResponse, type SaleReceipt, type SendReceiptEmailResponse } from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../../common/audit/audit.service';
import type { AppClsStore } from '../../../common/cls';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SettingsService } from '../../../common/settings/settings.service';
import { posErrors } from '../pos/pos.errors';
import { SaleVisibilityService } from './sale-visibility.service';

/** Deliberately simple: the mail server is the real check. It only stops obvious typos. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The receipt of a completed sale (HU-VEN-11): its data for the ticket and the e-mail request. Reading it changes nothing.
 * The receipt never carries costs, and the customer's tax data comes from the invoice record, not from the customer row.
 */
@Injectable()
export class SaleReceiptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly settings: SettingsService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly visibility: SaleVisibilityService,
  ) {}

  async receipt(saleId: string): Promise<SaleReceipt> {
    // the cashier's own sales, or every sale for who holds `sales.history.view-all` (HU-VEN-12)
    const scope = await this.visibility.resolve();
    const sale = await this.prisma.tenant.sale.findFirst({
      where: { AND: [{ id: saleId }, scope.where] },
      include: {
        items: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          include: { product: { select: { manufacturerCode: true, name: true } } },
        },
        payments: { orderBy: { id: 'asc' } },
        invoice: true,
        branch: { select: { name: true } },
        customer: { select: { email: true } },
      },
    });
    if (!sale || !sale.invoice) throw posErrors.saleNotFound();
    const [company, cashier, format] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({
        where: { id: sale.companyId },
        select: { tradeName: true, legalName: true, nit: true },
      }),
      this.prisma.user.findUnique({ where: { id: sale.createdById }, select: { name: true } }),
      this.settings.get('sales.receiptFormat'),
    ]);
    return {
      saleId: sale.id,
      number: sale.number,
      createdAt: sale.createdAt.toISOString(),
      company,
      branch: { name: sale.branch.name },
      cashier: { name: cashier?.name ?? '' },
      customer: {
        name: sale.invoice.customerTaxName,
        documentType: sale.invoice.customerDocumentType,
        documentNumber: sale.invoice.customerDocumentNumber,
        // the complement is a customer detail the invoice record does not copy
        complement: null,
        email: sale.customer?.email ?? null,
      },
      lines: sale.items.map((item) => ({
        code: item.product.manufacturerCode,
        name: item.product.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toFixed(2),
        lineTotal: item.lineTotal.toFixed(2),
      })),
      subtotal: sale.subtotal.toFixed(2),
      discountType: sale.discountType,
      discountAmount: sale.discountAmount.toFixed(2),
      roundingAmount: sale.roundingAmount.toFixed(2),
      total: sale.total.toFixed(2),
      payments: sale.payments.map((p) => ({
        method: p.method,
        amount: p.amount.toFixed(2),
        change: p.change.toFixed(2),
      })),
      invoiceStatus: sale.invoice.status,
      format,
    };
  }

  /** Records that the receipt is printed again (HU-VEN-13); the reprinted ticket shows the returned instant. */
  async reprint(saleId: string): Promise<ReprintReceiptResponse> {
    const scope = await this.visibility.resolve();
    const sale = await this.prisma.tenant.sale.findFirst({ where: { AND: [{ id: saleId }, scope.where] }, select: { id: true } });
    if (!sale) throw posErrors.saleNotFound();
    const printedAt = new Date();
    await this.audit.log({ action: 'sales.receipt.reprint', entity: 'Sale', entityId: sale.id, after: { printedAt: printedAt.toISOString() } });
    return { printedAt: printedAt.toISOString() };
  }

  /** Queues the receipt e-mail through the outbox; the worker delivers it. The text has no NIT and no costs. */
  async sendEmail(saleId: string, email: string): Promise<SendReceiptEmailResponse> {
    const address = email.trim();
    if (!EMAIL.test(address)) throw posErrors.invalidEmail();
    const receipt = await this.receipt(saleId);
    await this.outbox.publish(
      'sale.receipt-email',
      {
        email: address,
        number: receipt.number,
        company: receipt.company.tradeName,
        text: receiptShareText(receipt),
      },
      { companyId: this.cls.get('companyId') },
    );
    await this.audit.log({
      action: 'sales.receipt.email',
      entity: 'Sale',
      entityId: saleId,
      after: { email: address },
    });
    return { queued: true };
  }
}
