import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  fiscalDebit,
  isDraftPeriod,
  isNitFormatValid,
  normalizeNit,
  type PurchaseBookRow,
  type PurchaseBookStatus,
  purchaseBookTotals,
  type PurchasesBookResponse,
  type SalesBookResponse,
  type SalesBookRow,
  salesBookTotals,
  vatBookPeriod,
} from '@rodasoft/domain';
import { SiatUnavailableError } from '@rodasoft/siat';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../common/audit/audit.service';
import type { AppClsStore } from '../../common/cls';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettingsService } from '../../common/settings/settings.service';
import { SiatGatewayFactory } from '../../common/siat/siat-gateway.factory';
import { dayStart, nextDayStart } from '../inventory/business-days';
import { invoicingErrors } from './invoicing.errors';

const PURCHASE_SELECT = {
  id: true,
  date: true,
  supplierNit: true,
  supplierName: true,
  authorizationCode: true,
  invoiceNumber: true,
  total: true,
  vatCredit: true,
  status: true,
  observation: true,
  nitVerifiedAt: true,
} satisfies Prisma.PurchaseBookEntrySelect;
type PurchaseRecord = Prisma.PurchaseBookEntryGetPayload<{ select: typeof PURCHASE_SELECT }>;

export interface PurchaseNitVerification {
  valid: boolean;
  messages: { code: number; description: string }[];
  entry: PurchaseBookRow;
}

/**
 * The VAT books of a La Paz month (HU-FAC-18, HU-FAC-19). The sales book is read from the invoices and credit notes the SIAT
 * validated in the period: a valid invoice adds its total and its 13 % fiscal debit, a cancelled one is listed with 0, a credit
 * note reduces both. The purchases book is the table `purchase_book_entries` (demo data until purchasing writes it): an entry
 * whose supplier NIT the SIN does not know is `OBSERVED` and adds no tax credit until it is verified.
 *
 * Both books are company-wide: who holds `invoicing.vat-books.view` sees every sale, whatever their sales visibility.
 */
@Injectable()
export class VatBooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly gateways: SiatGatewayFactory,
  ) {}

  async sales(query: { period: string; branchId?: string }, now = new Date()): Promise<SalesBookResponse> {
    const range = this.range(query.period);
    const branch = query.branchId ? { branchId: query.branchId } : {};
    const [invoices, notes, header] = await Promise.all([
      this.prisma.tenant.invoice.findMany({
        where: { ...branch, status: { in: ['VALID', 'CANCELLATION_PENDING', 'CANCELLED'] }, issuedAt: range, number: { not: null }, cuf: { not: null } },
        select: { id: true, status: true, issuedAt: true, number: true, cuf: true, customerDocumentNumber: true, customerTaxName: true, total: true },
      }),
      this.prisma.tenant.creditNote.findMany({
        where: { ...branch, status: 'VALID', issuedAt: range, number: { not: null }, cuf: { not: null } },
        select: { id: true, issuedAt: true, number: true, cuf: true, customerDocumentNumber: true, customerTaxName: true, total: true, vatAdjusted: true },
      }),
      this.header(query.period, now),
    ]);

    const rows: SalesBookRow[] = [
      ...invoices.map((invoice): SalesBookRow => {
        const cancelled = invoice.status === 'CANCELLED';
        const total = invoice.total.toFixed(2);
        return {
          id: invoice.id,
          kind: 'INVOICE',
          date: (invoice.issuedAt as Date).toISOString(),
          number: invoice.number as number,
          cuf: invoice.cuf as string,
          customerDocumentNumber: invoice.customerDocumentNumber,
          customerName: invoice.customerTaxName,
          // a cancelled invoice stays in the book but adds nothing
          total: cancelled ? '0.00' : total,
          fiscalDebit: cancelled ? '0.00' : fiscalDebit(total).toString(),
          status: cancelled ? 'CANCELLED' : 'VALID',
        };
      }),
      ...notes.map(
        (note): SalesBookRow => ({
          id: note.id,
          kind: 'CREDIT_NOTE',
          date: (note.issuedAt as Date).toISOString(),
          number: note.number as number,
          cuf: note.cuf as string,
          customerDocumentNumber: note.customerDocumentNumber,
          customerName: note.customerTaxName,
          total: note.total.toFixed(2),
          fiscalDebit: note.vatAdjusted.toFixed(2),
          status: 'VALID',
        }),
      ),
    ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));
    return { ...header, rows, totals: salesBookTotals(rows) };
  }

  async purchases(query: { period: string }, now = new Date()): Promise<PurchasesBookResponse> {
    this.range(query.period);
    const [entries, header] = await Promise.all([
      this.prisma.tenant.purchaseBookEntry.findMany({ where: { period: query.period }, orderBy: [{ date: 'desc' }, { id: 'desc' }], select: PURCHASE_SELECT }),
      this.header(query.period, now),
    ]);
    const rows = entries.map(toPurchaseRow);
    return { ...header, rows, totals: purchaseBookTotals(rows) };
  }

  /**
   * Asks the SIN whether it knows the supplier's NIT (the stored one, or a corrected one) and validates the entry when it does: a
   * valid entry adds its tax credit. An unknown NIT leaves the entry observed; an unreachable SIAT changes nothing (503).
   */
  async verifyPurchaseNit(entryId: string, input: { supplierNit?: string } = {}): Promise<PurchaseNitVerification> {
    const companyId = this.cls.get('companyId') ?? '';
    const entry = await this.prisma.tenant.purchaseBookEntry.findFirst({ where: { id: entryId }, select: PURCHASE_SELECT });
    if (!entry) throw invoicingErrors.purchaseEntryNotFound();
    const nit = normalizeNit(input.supplierNit?.trim() || entry.supplierNit);
    if (!isNitFormatValid(nit)) throw invoicingErrors.invalidBookQuery('supplierNit', 'NIT_INVALID');

    const gateway = await this.gateways.forCurrentCompany();
    let result: { valid: boolean; messages: { code: number; description: string }[] };
    try {
      result = await gateway.verifyNit(nit);
    } catch (error) {
      if (error instanceof SiatUnavailableError) throw invoicingErrors.siatUnavailable();
      throw error;
    }

    const updated = await this.prisma.tenant.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM purchase_book_entries WHERE id = ${entryId}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;
      const message = result.messages.map((m) => m.description).join('; ') || null;
      // read again under the lock: a valid entry is never demoted by a later negative answer (its credit would vanish from the book)
      const current = await tx.purchaseBookEntry.findFirstOrThrow({ where: { id: entryId }, select: { status: true } });
      const data: Prisma.PurchaseBookEntryUpdateInput = result.valid
        ? { status: 'VALID', supplierNit: nit, nitVerifiedAt: new Date(), observation: null }
        : current.status === 'OBSERVED'
          ? { observation: message ?? entry.observation }
          : {};
      const saved = await tx.purchaseBookEntry.update({ where: { id: entryId }, data, select: PURCHASE_SELECT });
      await this.audit.log(
        {
          action: 'invoicing.purchase.verify-nit',
          entity: 'PurchaseBookEntry',
          entityId: entryId,
          before: { status: entry.status, supplierNit: entry.supplierNit },
          after: { status: saved.status, supplierNit: nit, valid: result.valid, message: message ?? undefined },
        },
        tx as unknown as Prisma.TransactionClient,
      );
      return saved;
    });
    return { valid: result.valid, messages: result.messages, entry: toPurchaseRow(updated) };
  }

  /** The exclusive range of `issued_at` of a period; an invalid period is a validation error. */
  private range(period: string): { gte: Date; lt: Date } {
    const days = vatBookPeriod(period);
    if (!days) throw invoicingErrors.invalidBookQuery('period', 'PERIOD_INVALID');
    return { gte: dayStart(days.firstDay), lt: nextDayStart(days.lastDay) };
  }

  private async header(period: string, now: Date) {
    const [format, exportFormats] = await Promise.all([this.settings.get('invoicing.vatBookFormat'), this.settings.get('invoicing.vatBookExportFormats')]);
    return { period, draft: isDraftPeriod(period, now), format, exportFormats };
  }
}

function toPurchaseRow(entry: PurchaseRecord): PurchaseBookRow {
  return {
    id: entry.id,
    date: entry.date.toISOString().slice(0, 10),
    supplierNit: entry.supplierNit,
    supplierName: entry.supplierName,
    authorizationCode: entry.authorizationCode,
    invoiceNumber: entry.invoiceNumber,
    total: entry.total.toFixed(2),
    vatCredit: entry.vatCredit.toFixed(2),
    status: entry.status as PurchaseBookStatus,
    observation: entry.observation,
    nitVerifiedAt: entry.nitVerifiedAt?.toISOString() ?? null,
  };
}
