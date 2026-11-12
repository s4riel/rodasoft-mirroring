/**
 * Series of the sales documents. Each one has a row-locked counter in `document_sequences` (key), a printed prefix and the
 * least digits it is printed with.
 */
export const SALES_DOCUMENT_SERIES = {
  sale: { key: 'SALE', prefix: 'V-', digits: 6 },
  quote: { key: 'QUOTE', prefix: 'COT-', digits: 6 },
  order: { key: 'ORDER', prefix: 'PED-', digits: 6 },
  dispatch: { key: 'DISPATCH', prefix: 'DSP-', digits: 6 },
  return: { key: 'RETURN', prefix: 'DEV-', digits: 6 },
  /** A cash shift (`T-0142`, Figma VP-23). */
  cashShift: { key: 'CASH_SHIFT', prefix: 'T-', digits: 4 },
} as const;

export type SalesDocumentSeries = keyof typeof SALES_DOCUMENT_SERIES;

/** `ref_type` of the stock movements and cash movements that a sale writes. */
export const SALE_REF_TYPE = 'SALE';

/** Prints a sequence of any series: prefix plus the digits of the series (six, four for a cash shift). */
export function formatSalesDocumentNumber(series: SalesDocumentSeries, sequence: number): string {
  const { prefix, digits } = SALES_DOCUMENT_SERIES[series];
  return `${prefix}${String(sequence).padStart(digits, '0')}`;
}

const format = formatSalesDocumentNumber;

/** `V-000231` */
export const formatSaleNumber = (sequence: number): string => format('sale', sequence);
/** `COT-000012` */
export const formatQuoteNumber = (sequence: number): string => format('quote', sequence);
/** `PED-000012` */
export const formatOrderNumber = (sequence: number): string => format('order', sequence);
/** `DSP-000012` */
export const formatDispatchNumber = (sequence: number): string => format('dispatch', sequence);
/** `DEV-000012` */
export const formatReturnNumber = (sequence: number): string => format('return', sequence);
/** `T-0142` */
export const formatCashShiftNumber = (sequence: number): string => format('cashShift', sequence);

/** The sequence inside a document number of the series, or null when the text is not one. */
export function parseSalesDocumentNumber(series: SalesDocumentSeries, number: string): number | null {
  const prefix = SALES_DOCUMENT_SERIES[series].prefix;
  if (!number.startsWith(prefix)) return null;
  const digits = number.slice(prefix.length);
  return /^\d+$/.test(digits) ? Number(digits) : null;
}
