import { Injectable } from '@nestjs/common';
import {
  Decimal,
  type PurchasesBookResponse,
  type SalesBookResponse,
  VAT_BOOK_EXPORT_FORMATS,
  VAT_BOOKS,
  type VatBook,
  type VatBookExportFormat,
  vatBookFileName,
} from '@rodasoft/domain';
import ExcelJS from 'exceljs';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../common/audit/audit.service';
import type { AppClsStore } from '../../common/cls';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { InvoiceFile } from './invoice-documents.service';
import { invoicingErrors } from './invoicing.errors';
import { VatBooksService } from './vat-books.service';

const LA_PAZ_DAY = new Intl.DateTimeFormat('es-BO', { timeZone: 'America/La_Paz', day: '2-digit', month: '2-digit', year: 'numeric' });
const CONTENT_TYPES: Record<VatBookExportFormat, string> = {
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  CSV: 'text/csv; charset=utf-8',
};
const DRAFT_MARK = 'BORRADOR';

/** A cell that would start a formula in a spreadsheet is written as text (customer and supplier names are free text). */
const safeText = (value: string): string => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);
const negative = (amount: string): string => (Decimal.of(amount).isZero() ? amount : `-${amount}`);
const pad = (n: number): string => String(n).padStart(6, '0');

interface Sheet {
  title: string;
  header: string[];
  rows: string[][];
  totals: string[];
}

/**
 * The file of a VAT book (HU-FAC-20): the sales or the purchases book of a period as XLSX or CSV, with the columns of the SIN's
 * "Libro de Compras y Ventas". PROVISIONAL: the column layout must be confirmed with the accountant (`invoicing.vatBookFormat`).
 * A period that is not closed yet (HU-FAC-21) is a draft: the file says "BORRADOR" in its title and in its name. Money is written as
 * decimal text, never as a float.
 */
@Injectable()
export class VatBookExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly books: VatBooksService,
    private readonly audit: AuditService,
  ) {}

  async export(query: { book: string; period: string; format: string }): Promise<InvoiceFile & { draft: boolean }> {
    if (!(VAT_BOOKS as readonly string[]).includes(query.book)) throw invoicingErrors.invalidBookQuery('book', 'BOOK_INVALID');
    if (!(VAT_BOOK_EXPORT_FORMATS as readonly string[]).includes(query.format)) throw invoicingErrors.invalidBookQuery('format', 'FORMAT_INVALID');
    const book = query.book as VatBook;
    const format = query.format as VatBookExportFormat;

    const data = book === 'SALES' ? await this.books.sales({ period: query.period }) : await this.books.purchases({ period: query.period });
    if (!data.exportFormats.includes(format)) throw invoicingErrors.invalidBookQuery('format', 'FORMAT_NOT_ALLOWED');
    const company = await this.prisma.company.findUnique({ where: { id: this.cls.get('companyId') ?? '' }, select: { legalName: true, nit: true } });

    const sheet = book === 'SALES' ? salesSheet(data as SalesBookResponse) : purchasesSheet(data as PurchasesBookResponse);
    const title = `${sheet.title} · Período ${data.period}${data.draft ? ` · ${DRAFT_MARK}` : ''}`;
    const heading = [[title], [`${company?.legalName ?? ''} · NIT ${company?.nit ?? ''}`], []];
    const content = format === 'XLSX' ? await toXlsx(sheet, heading) : toCsv(sheet, heading);

    await this.audit.log({ action: 'invoicing.book.export', entity: 'VatBook', after: { book, period: data.period, format, draft: data.draft, rows: sheet.rows.length } });
    return { filename: vatBookFileName(book, data.period, format, data.draft), contentType: CONTENT_TYPES[format], content, draft: data.draft };
  }
}

function salesSheet(book: SalesBookResponse): Sheet {
  return {
    title: 'LIBRO DE VENTAS IVA',
    header: ['N.º', 'Especificación', 'Fecha', 'N.º de documento', 'Código de autorización', 'NIT / CI cliente', 'Nombre o razón social', 'Importe total (Bs)', 'Débito fiscal (Bs)', 'Estado', 'Tipo'],
    rows: book.rows.map((row, index) => {
      // a credit note takes its amounts back: it goes with a minus sign so the column adds up to the totals row
      const note = row.kind === 'CREDIT_NOTE';
      return [
        String(index + 1),
        '2',
        LA_PAZ_DAY.format(new Date(row.date)),
        pad(row.number),
        safeText(row.cuf),
        safeText(row.customerDocumentNumber),
        safeText(row.customerName),
        note ? negative(row.total) : row.total,
        note ? negative(row.fiscalDebit) : row.fiscalDebit,
        row.status === 'CANCELLED' ? 'Anulada' : 'Válida',
        note ? 'Nota de crédito-débito' : 'Factura',
      ];
    }),
    totals: ['', '', '', '', '', '', 'TOTAL', book.totals.netAmount, book.totals.fiscalDebit, '', ''],
  };
}

function purchasesSheet(book: PurchasesBookResponse): Sheet {
  return {
    title: 'LIBRO DE COMPRAS IVA',
    header: ['N.º', 'Especificación', 'Fecha', 'N.º de factura', 'Código de autorización', 'NIT proveedor', 'Razón social proveedor', 'Importe total (Bs)', 'Crédito fiscal (Bs)', 'Estado'],
    rows: book.rows.map((row, index) => {
      const [year, month, day] = row.date.split('-');
      const observed = row.status === 'OBSERVED';
      return [
        String(index + 1),
        '1',
        `${day}/${month}/${year}`,
        safeText(row.invoiceNumber),
        safeText(row.authorizationCode),
        safeText(row.supplierNit),
        safeText(row.supplierName),
        row.total,
        // an observed purchase adds no tax credit until its NIT is verified
        observed ? '0.00' : row.vatCredit,
        observed ? 'Observada' : 'Válida',
      ];
    }),
    totals: ['', '', '', '', '', '', 'TOTAL (sin observadas)', book.totals.totalAmount, book.totals.vatCredit, ''],
  };
}

async function toXlsx(sheet: Sheet, heading: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Libro');
  for (const line of heading) worksheet.addRow(line);
  worksheet.getRow(1).font = { bold: true };
  worksheet.addRow(sheet.header).font = { bold: true };
  for (const row of sheet.rows) worksheet.addRow(row);
  worksheet.addRow(sheet.totals).font = { bold: true };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function toCsv(sheet: Sheet, heading: string[][]): Buffer {
  const cell = (value: string): string => (/[",;\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = [...heading, sheet.header, ...sheet.rows, sheet.totals].map((row) => row.map(cell).join(','));
  // the BOM is how Excel recognises a UTF-8 CSV
  return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf-8');
}
