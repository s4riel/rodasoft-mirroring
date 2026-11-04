/**
 * The sale receipt (HU-VEN-11): its contract and the pure helpers that build what the ticket, the WhatsApp text and the
 * e-mail show. Until the SIAT epic issues the invoice, the ticket carries no SIAT QR.
 */
import type { ReceiptFormat } from './company-settings';
import { Decimal, MONEY_SCALE } from './money';
import type { CustomerDiscountType } from './sales-pricing';

export type PaymentMethod = 'CASH' | 'QR' | 'CARD' | 'TRANSFER' | 'CREDIT';

export interface SaleReceiptLine {
  code: string;
  name: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
}

export interface SaleReceiptPayment {
  method: PaymentMethod;
  /** What the sale kept from this payment. */
  amount: string;
  /** Cash given back; `0.00` for the other methods. */
  change: string;
}

/** `GET /sales/sales/:id/receipt`. It never carries costs. */
export interface SaleReceipt {
  saleId: string;
  /** `V-000125`. */
  number: string;
  /** ISO instant; the ticket prints it in `America/La_Paz`. */
  createdAt: string;
  company: { tradeName: string; legalName: string; nit: string };
  branch: { name: string };
  cashier: { name: string };
  /** The tax data of the invoice record (final consumer: NIT 0, "S/N"). */
  customer: { name: string; documentType: number; documentNumber: string; complement: string | null; email: string | null };
  lines: SaleReceiptLine[];
  subtotal: string;
  discountType: CustomerDiscountType;
  discountAmount: string;
  roundingAmount: string;
  total: string;
  payments: SaleReceiptPayment[];
  invoiceStatus: string;
  format: ReceiptFormat;
}

/** `POST /sales/sales/:id/receipt/email`. */
export interface SendReceiptEmailInput {
  email: string;
}

export interface SendReceiptEmailResponse {
  queued: true;
}

/** One printed line: the description, the "qty × price" detail and the line total, already formatted in Bolivian style. */
export interface ReceiptLineView {
  description: string;
  detail: string;
  total: string;
}

const money = (value: string): string => Decimal.of(value).round(MONEY_SCALE).format();

export function buildReceiptLines(lines: readonly SaleReceiptLine[]): ReceiptLineView[] {
  return lines.map((line) => ({
    description: `${line.code} · ${line.name}`,
    detail: `${line.quantity} × ${money(line.unitPrice)}`,
    total: money(line.lineTotal),
  }));
}

/** Bolivia is UTC−4 all year, so the offset is fixed (`America/La_Paz`, no daylight saving time). */
const LA_PAZ_OFFSET_MS = -4 * 60 * 60 * 1000;

/** `14/10/2026 10:42`, in the business timezone. */
export function formatReceiptDate(iso: string): string {
  const local = new Date(new Date(iso).getTime() + LA_PAZ_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(local.getUTCDate())}/${pad(local.getUTCMonth() + 1)}/${local.getUTCFullYear()} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

/** The text of the WhatsApp message (a `wa.me` link, no server call). It never includes the customer's NIT or any cost. */
export function receiptShareText(receipt: SaleReceipt): string {
  const lines = buildReceiptLines(receipt.lines).map((l) => `• ${l.description}: ${l.detail} = ${l.total}`);
  return [
    `${receipt.company.tradeName} · Comprobante ${receipt.number}`,
    formatReceiptDate(receipt.createdAt),
    '',
    ...lines,
    '',
    `Total: ${money(receipt.total)}`,
    'Gracias por su compra.',
  ].join('\n');
}
