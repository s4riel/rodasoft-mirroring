/** Series of the sales documents. Each one has a row-locked counter in `document_sequences` (key) and a printed prefix. */
export const SALES_DOCUMENT_SERIES = {
  sale: { key: 'SALE', prefix: 'V-' },
  quote: { key: 'QUOTE', prefix: 'COT-' },
  order: { key: 'ORDER', prefix: 'PED-' },
  dispatch: { key: 'DISPATCH', prefix: 'DSP-' },
  return: { key: 'RETURN', prefix: 'DEV-' },
} as const;

export type SalesDocumentSeries = keyof typeof SALES_DOCUMENT_SERIES;

/** `ref_type` of the stock movements and cash movements that a sale writes. */
export const SALE_REF_TYPE = 'SALE';

/** Prints a sequence of any series: prefix plus six digits. */
export function formatSalesDocumentNumber(series: SalesDocumentSeries, sequence: number): string {
  return `${SALES_DOCUMENT_SERIES[series].prefix}${String(sequence).padStart(6, '0')}`;
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

/** The sequence inside a document number of the series, or null when the text is not one. */
export function parseSalesDocumentNumber(series: SalesDocumentSeries, number: string): number | null {
  const prefix = SALES_DOCUMENT_SERIES[series].prefix;
  if (!number.startsWith(prefix)) return null;
  const digits = number.slice(prefix.length);
  return /^\d+$/.test(digits) ? Number(digits) : null;
}
