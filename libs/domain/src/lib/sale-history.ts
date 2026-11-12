/**
 * The sales history (HU-VEN-12, HU-VEN-13): the contract of the list and of a sale's detail, plus the pure helpers behind
 * them. Money travels as fixed-point strings. Nothing here carries costs (HU-TRV-02).
 */
import type { ReceiptFormat } from './company-settings';
import type { SaleCancellationState } from './sale-cancellation';
import type { PaymentMethod, SaleReceiptLine } from './sale-receipt';
import type { SaleReturnRef } from './sale-return';
import type { CustomerDiscountType } from './sales-pricing';
import type { SaleStatus } from './state-machine';

export const SALE_PAGE_SIZE_DEFAULT = 20;
export const SALE_PAGE_SIZE_MAX = 100;

export const SALE_STATUSES: readonly SaleStatus[] = ['COMPLETED', 'CANCELLATION_PENDING', 'CANCELLED'];
export const SALE_PAYMENT_METHODS: readonly PaymentMethod[] = ['CASH', 'QR', 'CARD', 'TRANSFER', 'CREDIT'];

/** Filters of `GET /sales/sales`. Dates are `YYYY-MM-DD` La Paz days. */
export interface SaleListQuery {
  page?: number;
  pageSize?: number;
  from?: string;
  to?: string;
  status?: SaleStatus;
  method?: PaymentMethod;
  /** Sale number, or the customer's name or document. */
  q?: string;
  /** Only honoured for who may see every sale; everyone else only ever sees their own. */
  cashierId?: string;
}

export interface SaleListItem {
  id: string;
  /** `V-000125`. */
  number: string;
  /** The tax name of the invoice record (final consumer: "S/N"). */
  customerName: string;
  /** ISO instant. */
  createdAt: string;
  /** Units sold: the sum of the line quantities. */
  itemsCount: number;
  total: string;
  status: SaleStatus;
  invoiceStatus: string;
  /** The distinct payment methods of the sale. */
  methods: PaymentMethod[];
}

export interface SaleListResponse {
  items: SaleListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SaleDetailPayment {
  method: PaymentMethod;
  amount: string;
  change: string;
  reference: string | null;
  /** Credit only (HU-VEN-34): the day the balance falls due, `YYYY-MM-DD`. */
  dueDate: string | null;
}

/** One entry of a sale's history, read from the audit log. */
export interface SaleHistoryEntry {
  /** The audit action, e.g. `sales.sale.complete`; the ERP turns it into Spanish. */
  action: string;
  /** ISO instant. */
  at: string;
  /** Who did it; null for a system action. */
  userName: string | null;
  /** Only the e-mail address of a receipt e-mail request. */
  email: string | null;
}

/** `GET /sales/sales/:id` (VP-02). */
export interface SaleDetail {
  id: string;
  number: string;
  createdAt: string;
  status: SaleStatus;
  branch: { name: string };
  cashier: { name: string };
  /** The order the sale invoices a dispatch of (HU-VEN-20); null for a POS sale. */
  order: { id: string; number: string } | null;
  customer: { name: string; documentType: number; documentNumber: string; email: string | null };
  lines: SaleReceiptLine[];
  subtotal: string;
  discountType: CustomerDiscountType;
  discountAmount: string;
  roundingAmount: string;
  total: string;
  payments: SaleDetailPayment[];
  invoice: { status: string; number: number | null };
  history: SaleHistoryEntry[];
  /** The cancellation request of the sale and whether another may be asked (HU-VEN-14). */
  cancellation: SaleCancellationState;
  receiptFormat: ReceiptFormat;
  /** The returns of the sale, newest first (HU-VEN-21). */
  returns: SaleReturnRef[];
  /** Whether some unit can still come back: the sale is completed and not fully returned. */
  returnable: boolean;
}

/** `POST /sales/sales/:id/receipt/reprint`. */
export interface ReprintReceiptResponse {
  /** ISO instant the reprint was recorded; the reprinted ticket shows it. */
  printedAt: string;
}

/** Units sold in a sale. */
export function saleItemsCount(lines: readonly { quantity: number }[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}
