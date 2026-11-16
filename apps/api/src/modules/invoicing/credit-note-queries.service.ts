import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  clampPage,
  type CreditableInvoice,
  creditableOf,
  creditNoteActions,
  type CreditNoteDetail,
  type CreditNoteListItem,
  type CreditNoteListResponse,
  type CreditNoteStatus,
  currentVatBookPeriod,
  Decimal,
  IdentityDocumentType,
  INVOICE_LEGEND_DEFAULT,
  INVOICE_PAGE_SIZE_DEFAULT,
  INVOICE_PAGE_SIZE_MAX,
  type InvoiceStatus,
  SIAT_CREDIT_NOTE_REASONS,
  vatBookPeriod,
} from '@rodasoft/domain';
import { EnvironmentCode, siatQrUrl } from '@rodasoft/siat';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../../common/cls';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettingsService } from '../../common/settings/settings.service';
import { MembershipService } from '../access/membership.service';
import { dayStart, nextDayStart } from '../inventory/business-days';
import { SaleVisibilityService } from '../sales/sales/sale-visibility.service';
import { creditableLines } from './creditable-lines';
import type { InvoiceFile } from './invoice-documents.service';
import { describeAudit } from './invoice-queries.service';
import { InvoicePdfService, type PdfDocumentTexts } from './invoice-pdf.service';
import type { ListCreditNotesQueryDto } from './invoicing.dto';
import { invoicingErrors } from './invoicing.errors';

const LIST_SELECT = {
  id: true,
  number: true,
  status: true,
  invoiceId: true,
  returnId: true,
  total: true,
  customerTaxName: true,
  issuedAt: true,
  createdAt: true,
  branchId: true,
  rejectionMessage: true,
  invoice: { select: { number: true } },
  return: { select: { number: true } },
} satisfies Prisma.CreditNoteSelect;
type ListRow = Prisma.CreditNoteGetPayload<{ select: typeof LIST_SELECT }>;

const pad = (n: number): string => String(n).padStart(6, '0');
const sum = (value: Prisma.Decimal | null | undefined): string => Decimal.of((value ?? 0).toString()).toString();

/** What the credit note screens read (HU-FAC-11): the list with its indicators, one note, its documents and what an invoice can still be credited. Read only. */
@Injectable()
export class CreditNoteQueriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly visibility: SaleVisibilityService,
    private readonly membership: MembershipService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly pdf: InvoicePdfService,
    private readonly settings: SettingsService,
  ) {}

  /** Notes of the sales the caller may see (the same rule as the invoices). */
  private async scope(): Promise<Prisma.CreditNoteWhereInput> {
    const { where } = await this.visibility.resolve();
    return { invoice: { sale: where } };
  }

  private async permissions(): Promise<Set<string>> {
    const membershipId = this.cls.get('membershipId');
    return membershipId ? this.membership.permissions(membershipId) : new Set<string>();
  }

  async list(query: ListCreditNotesQueryDto): Promise<CreditNoteListResponse> {
    const scope = await this.scope();
    const page = clampPage(query.page);
    const pageSize = Math.min(query.pageSize ?? INVOICE_PAGE_SIZE_DEFAULT, INVOICE_PAGE_SIZE_MAX);

    const and: Prisma.CreditNoteWhereInput[] = [scope];
    if (query.status) and.push({ status: query.status });
    if (query.branchId) and.push({ branchId: query.branchId });
    if (query.q) {
      const number = /^\d{1,9}$/.test(query.q) ? Number(query.q) : null;
      and.push({
        OR: [
          ...(number !== null ? [{ number }, { invoice: { number } }] : []),
          { return: { number: { contains: query.q, mode: 'insensitive' as const } } },
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
    const where: Prisma.CreditNoteWhereInput = { AND: and };

    const month = vatBookPeriod(currentVatBookPeriod(new Date()));
    const thisMonth: Prisma.CreditNoteWhereInput = {
      AND: [scope, { status: 'VALID' }, ...(month ? [{ issuedAt: { gte: dayStart(month.firstDay), lt: nextDayStart(month.lastDay) } }] : [])],
    };

    const [permissions, total, rows, filtered, issued, fromReturns, notIssued, rejected] = await Promise.all([
      this.permissions(),
      this.prisma.tenant.creditNote.count({ where }),
      this.prisma.tenant.creditNote.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize, select: LIST_SELECT }),
      this.prisma.tenant.creditNote.aggregate({ where, _sum: { total: true } }),
      this.prisma.tenant.creditNote.aggregate({ where: thisMonth, _sum: { total: true }, _count: true }),
      this.prisma.tenant.creditNote.count({ where: { AND: [thisMonth, { returnId: { not: null } }] } }),
      this.prisma.tenant.creditNote.count({ where: { AND: [scope, { status: 'PENDING' }] } }),
      this.prisma.tenant.creditNote.count({ where: { AND: [scope, { status: 'REJECTED' }] } }),
    ]);

    return {
      items: rows.map((row) => this.item(row, permissions)),
      total,
      page,
      pageSize,
      totalAmount: sum(filtered._sum.total),
      kpis: { issuedThisMonth: { count: issued._count, total: sum(issued._sum.total) }, notIssued, fromReturns, rejected },
    };
  }

  async detail(noteId: string): Promise<CreditNoteDetail> {
    const scope = await this.scope();
    const note = await this.prisma.tenant.creditNote.findFirst({
      where: { AND: [scope, { id: noteId }] },
      include: {
        invoice: { select: { id: true, number: true, status: true, issuedAt: true, total: true, saleId: true } },
        return: { select: { number: true } },
        branch: { select: { name: true } },
        items: { orderBy: { id: 'asc' }, include: { saleItem: { select: { product: { select: { manufacturerCode: true } } } } } },
      },
    });
    if (!note) throw invoicingErrors.noteNotFound();

    const [permissions, audit] = await Promise.all([
      this.permissions(),
      this.prisma.auditLog.findMany({
        where: { companyId: note.companyId, entity: 'CreditNote', entityId: note.id },
        orderBy: { id: 'asc' },
        select: { action: true, createdAt: true, userId: true, after: true },
      }),
    ]);
    const userIds = [...new Set(audit.map((entry) => entry.userId).filter((id): id is string => id !== null))];
    const users = userIds.length > 0 ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
    const names = new Map(users.map((user) => [user.id, user.name]));

    return {
      ...this.item(note, permissions),
      cuf: note.cuf,
      siatReceptionCode: note.siatReceptionCode,
      rejectionCode: note.rejectionCode,
      lastError: note.lastError,
      reasonCode: note.reasonCode,
      vatAdjusted: note.vatAdjusted.toFixed(2),
      customerDocumentNumber: note.customerDocumentNumber,
      branchName: note.branch.name,
      invoice: {
        id: note.invoice.id,
        number: note.invoice.number,
        status: note.invoice.status as InvoiceStatus,
        issuedAt: note.invoice.issuedAt?.toISOString() ?? null,
        total: note.invoice.total.toFixed(2),
        saleId: note.invoice.saleId,
      },
      lines: note.items.map((item) => ({
        saleItemId: item.saleItemId,
        code: item.saleItem.product.manufacturerCode,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toFixed(2),
        amount: item.amount.toFixed(2),
      })),
      history: audit.map((entry) => ({
        at: entry.createdAt.toISOString(),
        action: entry.action,
        actor: entry.userId ? (names.get(entry.userId) ?? null) : null,
        detail: describeAudit(entry.after),
      })),
    };
  }

  /** What is still creditable of each line of an invoice, for the price-adjustment form (FS-25). */
  async creditable(invoiceId: string): Promise<CreditableInvoice> {
    const { where } = await this.visibility.resolve();
    const invoice = await this.prisma.tenant.invoice.findFirst({
      where: { AND: [{ sale: where }, { id: invoiceId }] },
      select: {
        id: true,
        saleId: true,
        number: true,
        status: true,
        total: true,
        customerTaxName: true,
        sale: { select: { items: { select: { id: true, unitPrice: true, product: { select: { name: true, manufacturerCode: true } } } } } },
      },
    });
    if (!invoice) throw invoicingErrors.notFound();
    const lines = await creditableLines(this.prisma.tenant, invoice);
    const products = new Map(invoice.sale.items.map((item) => [item.id, item]));
    return {
      invoiceId: invoice.id,
      saleId: invoice.saleId,
      priceAdjustmentAllowed: await this.settings.get('invoicing.allowPriceAdjustmentNotes'),
      invoiceNumber: invoice.number,
      customerName: invoice.customerTaxName,
      total: invoice.total.toFixed(2),
      credited: lines.reduce((acc, line) => acc.add(Decimal.of(line.creditedAmount)), Decimal.zero()).toString(),
      reasons: [...SIAT_CREDIT_NOTE_REASONS],
      lines: lines.map((line) => {
        const left = creditableOf(line);
        const item = products.get(line.saleItemId);
        return {
          saleItemId: line.saleItemId,
          code: item?.product.manufacturerCode ?? '',
          description: item?.product.name ?? '',
          unitPrice: item?.unitPrice.toFixed(2) ?? '0.00',
          invoicedQuantity: line.invoicedQuantity,
          invoicedAmount: line.invoicedAmount,
          creditableQuantity: left.quantity,
          creditableAmount: left.amount.toString(),
        };
      }),
    };
  }

  async pdfOf(noteId: string): Promise<InvoiceFile> {
    const data = await this.load(noteId);
    const content = await this.pdf.render({
      issuerName: data.issuerName,
      issuerNit: data.issuerNit,
      branchName: data.branchName,
      pointOfSale: data.pointOfSale,
      number: data.number,
      cuf: data.cuf,
      issuedAt: data.issuedAt,
      status: 'VALID',
      customerName: data.customerName,
      customerDocument: data.customerDocument,
      lines: data.lines,
      total: data.total,
      legend: INVOICE_LEGEND_DEFAULT,
      verificationUrl: data.verificationUrl,
      document: data.texts,
    });
    return { filename: `nota-credito-debito-${pad(data.number)}.pdf`, contentType: 'application/pdf', content };
  }

  async xmlOf(noteId: string): Promise<InvoiceFile> {
    const data = await this.load(noteId);
    return { filename: `nota-credito-debito-${pad(data.number)}.xml`, contentType: 'application/xml', content: Buffer.from(data.xml, 'utf-8') };
  }

  /** The note with everything a document needs; hidden or missing → not found, not validated by the SIAT → `NOTE_NOT_ISSUED`. */
  private async load(noteId: string) {
    const scope = await this.scope();
    const note = await this.prisma.tenant.creditNote.findFirst({
      where: { AND: [scope, { id: noteId }] },
      include: {
        document: true,
        company: { select: { legalName: true, nit: true } },
        branch: { select: { name: true } },
        pointOfSale: { select: { code: true, name: true } },
        invoice: { select: { number: true } },
        items: { orderBy: { id: 'asc' }, select: { description: true, quantity: true, unitPrice: true, amount: true } },
      },
    });
    if (!note) throw invoicingErrors.noteNotFound();
    if (note.status !== 'VALID' || note.number === null || !note.cuf || !note.issuedAt || !note.document) throw invoicingErrors.noteNotIssued();
    const settings = await this.prisma.siatSettings.findUnique({ where: { companyId: note.companyId }, select: { environment: true } });
    const environment = settings?.environment === 'PRODUCTION' ? EnvironmentCode.Production : EnvironmentCode.Test;
    const reason = SIAT_CREDIT_NOTE_REASONS.find((r) => r.code === note.reasonCode)?.description ?? '';
    const texts: PdfDocumentTexts = {
      name: 'Nota de crédito-débito',
      title: 'NOTA DE CRÉDITO-DÉBITO',
      subtitle: 'Documento de ajuste',
      numberLabel: 'Nota N.º',
      totalLabel: `IVA a ajustar (13 %) Bs ${note.vatAdjusted.toFixed(2)} · TOTAL ACREDITADO`,
      reference: `Corrige la factura N.º ${note.invoice.number === null ? '—' : pad(note.invoice.number)}${reason ? ` · Motivo: ${reason}` : ''}`,
      closing: 'Este documento es la representación gráfica de una nota de crédito-débito emitida por el SIAT. Verifícala con el código QR.',
    };
    return {
      issuerName: note.company.legalName,
      issuerNit: note.company.nit,
      branchName: note.branch.name,
      pointOfSale: note.pointOfSale ? `${note.pointOfSale.code} · ${note.pointOfSale.name}` : null,
      number: note.number,
      cuf: note.cuf,
      issuedAt: note.issuedAt,
      customerName: note.customerTaxName,
      customerDocument: `${note.customerDocumentType === IdentityDocumentType.NIT ? 'NIT' : 'Documento'} ${note.customerDocumentNumber}`,
      lines: note.items.map((item) => ({ description: item.description, quantity: item.quantity, unitPrice: item.unitPrice.toFixed(2), total: item.amount.toFixed(2) })),
      total: note.total.toFixed(2),
      xml: note.document.signedXml,
      verificationUrl: siatQrUrl({ environment, nit: note.company.nit, cuf: note.cuf, number: note.number }),
      texts,
    };
  }

  private item(row: ListRow, permissions: Set<string>): CreditNoteListItem {
    const status = row.status as CreditNoteStatus;
    return {
      id: row.id,
      number: row.number,
      status,
      invoiceId: row.invoiceId,
      invoiceNumber: row.invoice.number,
      customerName: row.customerTaxName,
      returnId: row.returnId,
      returnNumber: row.return?.number ?? null,
      total: row.total.toFixed(2),
      issuedAt: row.issuedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      branchId: row.branchId,
      rejectionMessage: row.rejectionMessage,
      actions: creditNoteActions(status, permissions),
    };
  }
}
