import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  IdentityDocumentType,
  INVOICE_BULK_DOWNLOAD_MAX,
  INVOICE_BULK_ISSUE_MAX,
  INVOICE_LEGEND_DEFAULT,
  type InvoiceBulkResult,
  type InvoiceDeliveryChannel,
  type InvoiceStatus,
  isInvoiceIssued,
  validateInvoiceDelivery,
  whatsappNumber,
} from '@rodasoft/domain';
import { EnvironmentCode, siatQrUrl } from '@rodasoft/siat';
import JSZip from 'jszip';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../common/audit/audit.service';
import type { AppClsStore } from '../../common/cls';
import { OutboxService } from '../../common/outbox/outbox.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SaleVisibilityService } from '../sales/sales/sale-visibility.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { invoicingErrors } from './invoicing.errors';

export type DocumentFormat = 'PDF' | 'XML';

export interface InvoiceFile {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface DownloadResult extends InvoiceFile {
  /** Invoices that went into the ZIP and invoices left out (not found, or not issued by the SIAT). */
  included: string[];
  skipped: string[];
}

const BULK_ERRORS_BY_CODE = (error: unknown): string => (error as { getResponse?: () => { code?: string } }).getResponse?.().code ?? 'UNKNOWN';

/** The documents of an issued invoice (HU-FAC-03, 05, 06): the PDF, the XML, a ZIP of several and their delivery. */
@Injectable()
export class InvoiceDocumentsService {
  private readonly logger = new Logger(InvoiceDocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly visibility: SaleVisibilityService,
    private readonly pdf: InvoicePdfService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async pdfOf(invoiceId: string): Promise<InvoiceFile> {
    const data = await this.load(invoiceId);
    return { filename: `factura-${pad(data.number)}.pdf`, contentType: 'application/pdf', content: await this.render(data) };
  }

  async xmlOf(invoiceId: string): Promise<InvoiceFile> {
    const data = await this.load(invoiceId);
    return { filename: `factura-${pad(data.number)}.xml`, contentType: 'application/xml', content: Buffer.from(data.xml, 'utf-8') };
  }

  /** A ZIP with one file per issued invoice; the ones that are not issued, or not visible, are listed as skipped. */
  async download(ids: string[], format: DocumentFormat): Promise<DownloadResult> {
    const zip = new JSZip();
    const included: string[] = [];
    const skipped: string[] = [];
    for (const id of [...new Set(ids)].slice(0, INVOICE_BULK_DOWNLOAD_MAX)) {
      try {
        const file = format === 'PDF' ? await this.pdfOf(id) : await this.xmlOf(id);
        zip.file(file.filename, file.content);
        included.push(id);
      } catch (error) {
        if (!['INVOICE_NOT_FOUND', 'INVOICE_NOT_ISSUED'].includes(BULK_ERRORS_BY_CODE(error))) throw error;
        skipped.push(id);
      }
    }
    await this.audit.log({ action: 'invoicing.invoice.download', entity: 'Invoice', after: { format, included, skipped } });
    const content = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    return { filename: `facturas-${format.toLowerCase()}.zip`, contentType: 'application/zip', content, included, skipped };
  }

  /** Sends one invoice by e-mail (PDF and XML attached, delivered by the worker) or builds the WhatsApp link. */
  async deliver(invoiceId: string, channel: InvoiceDeliveryChannel, recipient: string): Promise<{ channel: InvoiceDeliveryChannel; url: string | null }> {
    const errors = validateInvoiceDelivery({ channel, recipient });
    if (errors.length > 0) {
      throw invoicingErrors.invalidDelivery(errors.map((error) => ({ field: 'recipient', error })));
    }
    const data = await this.load(invoiceId);
    const to = recipient.trim();
    let url: string | null = null;
    await this.prisma.tenant.$transaction(async (tx) => {
      const db = tx as unknown as Prisma.TransactionClient;
      if (channel === 'EMAIL') {
        const pdf = await this.render(data);
        await this.outbox.publish(
          'invoice.email',
          {
            email: to,
            number: pad(data.number),
            company: data.issuerName,
            pdfBase64: pdf.toString('base64'),
            xmlBase64: Buffer.from(data.xml, 'utf-8').toString('base64'),
          },
          { tx: db },
        );
      } else {
        const text = `Factura ${pad(data.number)} de ${data.issuerName} por Bs ${data.total}. Verifícala en el SIN: ${data.verificationUrl}`;
        url = `https://wa.me/${whatsappNumber(to)}?text=${encodeURIComponent(text)}`;
      }
      await this.audit.log({ action: 'invoicing.invoice.deliver', entity: 'Invoice', entityId: invoiceId, after: { channel, recipient: to } }, db);
    });
    return { channel, url };
  }

  /** E-mails up to 50 invoices to the e-mail of their customer; an invoice whose customer has none is reported, not skipped silently. */
  async deliverMany(ids: string[]): Promise<InvoiceBulkResult[]> {
    const scope = await this.visibility.resolve();
    const rows = await this.prisma.tenant.invoice.findMany({
      where: { AND: [{ sale: scope.where }, { id: { in: ids } }] },
      select: { id: true, sale: { select: { customer: { select: { email: true } } } } },
    });
    const emails = new Map(rows.map((row) => [row.id, row.sale.customer?.email ?? null]));
    const results: InvoiceBulkResult[] = [];
    for (const id of [...new Set(ids)].slice(0, INVOICE_BULK_ISSUE_MAX)) {
      if (!emails.has(id)) {
        results.push({ id, ok: false, code: 'INVOICE_NOT_FOUND' });
        continue;
      }
      const email = emails.get(id);
      if (!email) {
        results.push({ id, ok: false, code: 'CUSTOMER_WITHOUT_EMAIL' });
        continue;
      }
      try {
        await this.deliver(id, 'EMAIL', email);
        results.push({ id, ok: true });
      } catch (error) {
        const code = BULK_ERRORS_BY_CODE(error);
        if (code === 'UNKNOWN') this.logger.error(`Sending invoice ${id} failed`, error instanceof Error ? error.stack : String(error));
        results.push({ id, ok: false, code });
      }
    }
    return results;
  }

  private async render(data: LoadedInvoice): Promise<Buffer> {
    return this.pdf.render({
      issuerName: data.issuerName,
      issuerNit: data.issuerNit,
      branchName: data.branchName,
      pointOfSale: data.pointOfSale,
      number: data.number,
      cuf: data.cuf,
      issuedAt: data.issuedAt,
      status: data.status,
      customerName: data.customerName,
      customerDocument: data.customerDocument,
      lines: data.lines,
      total: data.total,
      legend: INVOICE_LEGEND_DEFAULT,
      verificationUrl: data.verificationUrl,
    });
  }

  /** The invoice with everything a document needs; hidden or missing → not found, not yet issued → `INVOICE_NOT_ISSUED`. */
  private async load(invoiceId: string): Promise<LoadedInvoice> {
    const scope = await this.visibility.resolve();
    const invoice = await this.prisma.tenant.invoice.findFirst({
      where: { AND: [{ sale: scope.where }, { id: invoiceId }] },
      include: {
        document: true,
        company: { select: { legalName: true, nit: true } },
        branch: { select: { name: true } },
        pointOfSale: { select: { code: true, name: true } },
        sale: { select: { items: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { quantity: true, unitPrice: true, lineTotal: true, product: { select: { name: true } } } } } },
      },
    });
    if (!invoice) throw invoicingErrors.notFound();
    if (!isInvoiceIssued(invoice.status as InvoiceStatus) || invoice.number === null || !invoice.cuf || !invoice.issuedAt || !invoice.document) {
      throw invoicingErrors.notIssued();
    }
    const settings = await this.prisma.siatSettings.findUnique({ where: { companyId: invoice.companyId }, select: { environment: true } });
    const environment = settings?.environment === 'PRODUCTION' ? EnvironmentCode.Production : EnvironmentCode.Test;
    const complement = invoice.customerComplement ? `-${invoice.customerComplement}` : '';
    return {
      issuerName: invoice.company.legalName,
      issuerNit: invoice.company.nit,
      branchName: invoice.branch.name,
      pointOfSale: invoice.pointOfSale ? `${invoice.pointOfSale.code} · ${invoice.pointOfSale.name}` : null,
      number: invoice.number,
      cuf: invoice.cuf,
      issuedAt: invoice.issuedAt,
      status: invoice.status as InvoiceStatus,
      customerName: invoice.customerTaxName,
      customerDocument: `${invoice.customerDocumentType === IdentityDocumentType.NIT ? 'NIT' : 'Documento'} ${invoice.customerDocumentNumber}${complement}`,
      lines: invoice.sale.items.map((item) => ({ description: item.product.name, quantity: item.quantity, unitPrice: item.unitPrice.toFixed(2), total: item.lineTotal.toFixed(2) })),
      total: invoice.total.toFixed(2),
      xml: invoice.document.signedXml,
      verificationUrl: siatQrUrl({ environment, nit: invoice.company.nit, cuf: invoice.cuf, number: invoice.number }),
    };
  }
}

interface LoadedInvoice {
  issuerName: string;
  issuerNit: string;
  branchName: string;
  pointOfSale: string | null;
  number: number;
  cuf: string;
  issuedAt: Date;
  status: InvoiceStatus;
  customerName: string;
  customerDocument: string;
  lines: { description: string; quantity: number; unitPrice: string; total: string }[];
  total: string;
  xml: string;
  verificationUrl: string;
}

const pad = (n: number): string => String(n).padStart(6, '0');
