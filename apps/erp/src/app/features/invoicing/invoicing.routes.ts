import { Route } from '@angular/router';
import { requiresInvoicingTab } from './invoicing-permission.guard';
import { INVOICING_TABS, type InvoicingTab } from './invoicing-tabs';

const tab = (key: string): InvoicingTab => INVOICING_TABS.find((t) => t.key === key) as InvoicingTab;

/**
 * `/invoicing`: the sub-navigation with the invoice list and detail, the credit notes (HU-FAC-11, 12), the SIAT system status
 * (HU-FAC-13), the VAT books and their periods (HU-FAC-18…21) and the fiscal configuration (HU-FAC-22…27). There is no contingency tab (client rule).
 */
export const INVOICING_ROUTES: Route[] = [
  {
    path: '',
    loadComponent: () => import('./invoicing-layout.page').then((m) => m.InvoicingLayoutPage),
    children: [
      { path: '', pathMatch: 'full', title: 'Facturación SIAT · ERP', loadComponent: () => import('./invoices.page').then((m) => m.InvoicesPage) },
      { path: 'cancellations', title: 'Anulaciones · ERP', loadComponent: () => import('./invoice-cancellations.page').then((m) => m.InvoiceCancellationsPage) },
      { path: 'invoices/:id', title: 'Factura · ERP', loadComponent: () => import('./invoice-detail.page').then((m) => m.InvoiceDetailPage) },
      { path: 'invoices/:id/credit-note', title: 'Emitir nota de crédito · ERP', loadComponent: () => import('./credit-note.page').then((m) => m.CreditNotePage) },
      { path: 'notes', canActivate: [requiresInvoicingTab(tab('notes'))], title: 'Notas de crédito · ERP', loadComponent: () => import('./credit-notes.page').then((m) => m.CreditNotesPage) },
      { path: 'notes/:id', canActivate: [requiresInvoicingTab(tab('notes'))], title: 'Nota de crédito · ERP', loadComponent: () => import('./credit-note-detail.page').then((m) => m.CreditNoteDetailPage) },
      { path: 'status', canActivate: [requiresInvoicingTab(tab('status'))], title: 'Estado del sistema SIAT · ERP', loadComponent: () => import('./siat-status.page').then((m) => m.SiatStatusPage) },
      { path: 'books/purchases/:id', canActivate: [requiresInvoicingTab(tab('books'))], title: 'Compra · ERP', loadComponent: () => import('./purchase-entry.page').then((m) => m.PurchaseEntryPage) },
      { path: 'books/periods', canActivate: [requiresInvoicingTab(tab('books'))], title: 'Períodos IVA · ERP', loadComponent: () => import('./vat-periods.page').then((m) => m.VatPeriodsPage) },
      { path: 'books', canActivate: [requiresInvoicingTab(tab('books'))], title: 'Libros IVA · ERP', loadComponent: () => import('./vat-books.page').then((m) => m.VatBooksPage) },
      // every `settings/*` page needs `invoicing.settings.manage` (the guard of the tab), so its buttons carry no `*rsCan` of their own
      { path: 'settings', canActivate: [requiresInvoicingTab(tab('settings'))], title: 'Configuración fiscal · ERP', loadComponent: () => import('./fiscal-settings.page').then((m) => m.FiscalSettingsPage) },
      { path: 'settings/credentials', canActivate: [requiresInvoicingTab(tab('settings'))], title: 'Credenciales · ERP', loadComponent: () => import('./fiscal-credentials.page').then((m) => m.FiscalCredentialsPage) },
      { path: 'settings/points-of-sale', canActivate: [requiresInvoicingTab(tab('settings'))], title: 'Puntos de venta · ERP', loadComponent: () => import('./points-of-sale.page').then((m) => m.PointsOfSalePage) },
      { path: 'settings/catalogs', canActivate: [requiresInvoicingTab(tab('settings'))], title: 'Catálogos del SIN · ERP', loadComponent: () => import('./fiscal-catalogs.page').then((m) => m.FiscalCatalogsPage) },
      { path: 'settings/homologation', canActivate: [requiresInvoicingTab(tab('settings'))], title: 'Homologación · ERP', loadComponent: () => import('./homologation.page').then((m) => m.HomologationPage) },
    ],
  },
];
