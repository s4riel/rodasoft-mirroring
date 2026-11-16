import {
  type CodeHealth,
  type CreditNoteAction,
  type CreditNoteListItem,
  type CreditNoteListQuery,
  type CreditNoteStatus,
  isCreditNoteStatus,
  type PurchaseBookRow,
  type SalesBookRow,
  SIAT_CREDIT_NOTE_REASONS,
} from '@rodasoft/domain';
import type { DocTableRow, DocTableStatus, RowMenuItem, SelectOption } from '@rodasoft/ui';
import { formatBs, formatDateTime } from '../sales/cash/cash-format';

/** Rows per page of the credit note list. */
export const NOTE_PAGE_SIZE = 10;

/** Spanish label and pill of each credit note status (FS-23). Like the invoice, a note the SIAT did not receive reads "No facturada en SIAT". */
export const NOTE_STATUS_PILLS: Record<CreditNoteStatus, DocTableStatus> = {
  PENDING: { label: 'No emitida en SIAT', status: 'warning', icon: 'alert' },
  SENDING: { label: 'Enviando', status: 'info' },
  VALID: { label: 'Válida', status: 'success', icon: 'check' },
  REJECTED: { label: 'Rechazada', status: 'danger', icon: 'close' },
  CANCELLED: { label: 'Anulada', status: 'idle' },
};

export const NOTE_STATUS_OPTIONS: SelectOption[] = (Object.keys(NOTE_STATUS_PILLS) as CreditNoteStatus[]).map((value) => ({ value, label: NOTE_STATUS_PILLS[value].label }));

export interface NoteUrlFilters {
  q: string;
  status: CreditNoteStatus | null;
  from: string | null;
  to: string | null;
  branchId: string | null;
  page: number;
}

export const parseNoteStatus = (raw: string | null): CreditNoteStatus | null => (isCreditNoteStatus(raw) ? raw : null);

export function toNoteQuery(f: NoteUrlFilters): CreditNoteListQuery {
  return { q: f.q || undefined, status: f.status ?? undefined, from: f.from ?? undefined, to: f.to ?? undefined, branchId: f.branchId ?? undefined, page: f.page, pageSize: NOTE_PAGE_SIZE };
}

/** The printed number (`000045`), or a dash while the SIAT has not numbered it. */
export const documentNumberLabel = (number: number | null): string => (number === null ? '—' : String(number).padStart(6, '0'));

/** Where a note comes from: the return it was born from, or a price adjustment. */
export const noteOriginLabel = (item: Pick<CreditNoteListItem, 'returnNumber'>): string => (item.returnNumber ? `Devolución ${item.returnNumber}` : 'Ajuste de precio');

export function toNoteRow(item: CreditNoteListItem): DocTableRow {
  return {
    id: item.id,
    label: documentNumberLabel(item.number),
    cells: {
      number: documentNumberLabel(item.number),
      customer: item.customerName,
      invoice: documentNumberLabel(item.invoiceNumber),
      origin: noteOriginLabel(item),
      total: formatBs(item.total),
      status: NOTE_STATUS_PILLS[item.status],
    },
  };
}

/** "1–3 de 3 notas", or empty when there are none. */
export function noteRangeLabel(page: number, shown: number, total: number): string {
  if (!total) return '';
  const from = (page - 1) * NOTE_PAGE_SIZE + 1;
  const to = Math.min(total, from + shown - 1);
  const fmt = (n: number) => n.toLocaleString('es-BO');
  return `${fmt(from)}–${fmt(to)} de ${fmt(total)} ${total === 1 ? 'nota' : 'notas'}`;
}

const NOTE_MENU: Record<CreditNoteAction, RowMenuItem> = {
  VIEW_DETAIL: { key: 'view', label: 'Ver detalle', icon: 'eye' },
  ISSUE: { key: 'issue', label: 'Emitir en el SIAT', icon: 'invoice' },
  VOID: { key: 'void', label: 'Anular nota', icon: 'close', danger: true, separated: true },
  DOWNLOAD_PDF: { key: 'pdf', label: 'Descargar PDF', icon: 'document' },
  DOWNLOAD_XML: { key: 'xml', label: 'Descargar XML', icon: 'export' },
};

export const noteMenuFor = (item: Pick<CreditNoteListItem, 'actions'>): RowMenuItem[] => item.actions.map((action) => NOTE_MENU[action]);

export const NOTE_HISTORY_LABELS: Record<string, string> = {
  'invoicing.note.create': 'Nota creada',
  'invoicing.note.issue': 'Envío al SIAT iniciado',
  'invoicing.note.accept': 'Validada por el SIAT',
  'invoicing.note.reject': 'Rechazada por el SIAT',
  'invoicing.note.unavailable': 'El SIAT no respondió: queda sin emitir',
};

export const noteHistoryLabel = (action: string): string => NOTE_HISTORY_LABELS[action] ?? action;

export const noteReasonLabel = (code: number): string => SIAT_CREDIT_NOTE_REASONS.find((reason) => reason.code === code)?.description ?? 'Otro';

// ── SIAT system status (FS-05, FS-11) ──

/** The pill of the health of a CUIS or a CUFD. */
export const CODE_HEALTH_PILLS: Record<CodeHealth, DocTableStatus> = {
  OK: { label: 'Vigente', status: 'success', icon: 'check' },
  EXPIRING: { label: 'Por vencer', status: 'warning', icon: 'alert' },
  EXPIRED: { label: 'Vencido', status: 'danger', icon: 'alert' },
};

/** "14/11/2026" of an expiry, as the Figma status cards print it. */
export const formatCodeExpiry = (iso: string): string => formatDateTime(iso).slice(0, 10);

/** The expiry as `format` prints it, or "Sin código" when the point of sale holds none. */
export function codeExpiryLabel(expiresAt: string | null, present: boolean, format: (iso: string) => string = formatDateTime): string {
  return present && expiresAt ? format(expiresAt) : 'Sin código';
}

// ── VAT books (FS-08, FS-10) ──

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** `2026-11` → "Noviembre 2026". */
export function periodLabel(period: string): string {
  const [year, month] = period.split('-');
  const name = MONTHS[Number(month) - 1] ?? month;
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`;
}

/** The last `count` La Paz periods ending at `current`, newest first, as select options; the open one says so. */
export function periodOptions(current: string, count = 12, markOpen = true): SelectOption[] {
  const [year, month] = current.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(Date.UTC(year, month - 1 - i, 1));
    const value = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    return { value, label: `${periodLabel(value)}${i === 0 && markOpen ? ' · abierto' : ''}` };
  });
}

export const SALES_BOOK_STATUS_PILLS: Record<string, DocTableStatus> = {
  VALID: { label: 'Válida', status: 'success', icon: 'check' },
  CANCELLED: { label: 'Anulada', status: 'idle' },
};

export const PURCHASE_STATUS_PILLS: Record<string, DocTableStatus> = {
  VALID: { label: 'Válida', status: 'success', icon: 'check' },
  OBSERVED: { label: 'Observada', status: 'danger', icon: 'alert' },
};

/** A dd/mm/yyyy date from the ISO day or timestamp of a book row. */
export function bookDate(value: string): string {
  const day = value.slice(0, 10).split('-');
  return `${day[2]}/${day[1]}/${day[0]}`;
}

export function toSalesBookRow(row: SalesBookRow): DocTableRow {
  const note = row.kind === 'CREDIT_NOTE';
  return {
    id: row.id,
    cells: {
      date: formatDateTime(row.date).slice(0, 10),
      number: `${note ? 'NC ' : ''}${documentNumberLabel(row.number)}`,
      customer: `${row.customerName} · ${row.customerDocumentNumber}`,
      total: note ? `−${formatBs(row.total)}` : formatBs(row.total),
      debit: note ? `−${formatBs(row.fiscalDebit)}` : formatBs(row.fiscalDebit),
      status: note ? { label: 'Nota de crédito', status: 'info' } : (SALES_BOOK_STATUS_PILLS[row.status] ?? ''),
    },
  };
}

export function toPurchaseRow(row: PurchaseBookRow): DocTableRow {
  return {
    id: row.id,
    cells: {
      date: bookDate(row.date),
      number: row.invoiceNumber,
      supplier: `${row.supplierName} · ${row.supplierNit}`,
      total: formatBs(row.total),
      // an observed purchase adds no tax credit
      credit: row.status === 'OBSERVED' ? '—' : formatBs(row.vatCredit),
      status: PURCHASE_STATUS_PILLS[row.status] ?? '',
    },
  };
}
