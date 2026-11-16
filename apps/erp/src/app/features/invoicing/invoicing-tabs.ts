import type { Permission } from '@rodasoft/domain';

/** One tab of the invoicing section (Figma SubNav): its route, label and who sees it. */
export interface InvoicingTab {
  key: string;
  /** Tab label (Spanish, UI content). */
  label: string;
  /** Route under `/invoicing`; the empty path is the invoice list. */
  path: string;
  /** The tab is for whoever holds at least one of these permissions. */
  permissions: readonly Permission[];
}

/** Same order as the Figma sub-navigation, without the contingency tab (client rule: no contingency). */
export const INVOICING_TABS: readonly InvoicingTab[] = [
  { key: 'invoices', label: 'Facturas', path: '', permissions: ['invoicing.invoices.view'] },
  { key: 'notes', label: 'Notas de crédito', path: 'notes', permissions: ['invoicing.invoices.view'] },
  { key: 'status', label: 'Estado del sistema', path: 'status', permissions: ['invoicing.invoices.view'] },
  { key: 'books', label: 'Libros IVA', path: 'books', permissions: ['invoicing.vat-books.view'] },
];

export const canSeeInvoicingTab = (tab: InvoicingTab, can: (permission: string) => boolean): boolean => tab.permissions.some(can);
