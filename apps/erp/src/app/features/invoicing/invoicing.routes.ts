import { Route } from '@angular/router';

/** `/invoicing`: the list and the detail of an invoice. The cancellations inbox and the other tabs arrive with their stories. */
export const INVOICING_ROUTES: Route[] = [
  { path: '', pathMatch: 'full', title: 'Facturación SIAT · ERP', loadComponent: () => import('./invoices.page').then((m) => m.InvoicesPage) },
  {
    path: 'cancellations',
    title: 'Anulaciones · ERP',
    loadComponent: () => import('./invoice-cancellations.page').then((m) => m.InvoiceCancellationsPage),
  },
  { path: 'invoices/:id', title: 'Factura · ERP', loadComponent: () => import('./invoice-detail.page').then((m) => m.InvoiceDetailPage) },
];
