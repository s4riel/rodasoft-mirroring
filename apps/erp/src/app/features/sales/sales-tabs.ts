import type { Permission } from '@rodasoft/domain';

/** One tab of the sales section: its route, who sees it, and the story that fills it. */
export interface SalesTab {
  key: string;
  /** Tab label (Spanish, UI content). */
  label: string;
  /** Child route of `/sales`. */
  path: string;
  /** The tab is for whoever holds at least one of these permissions. */
  permissions: readonly Permission[];
  /** The story that builds the screen, shown by the placeholder until then. */
  story: string;
}

/** Same order as the Figma sub-navigation; Aprobaciones (VP-25) stays last. */
export const SALES_TABS: readonly SalesTab[] = [
  { key: 'pos', label: 'Punto de venta', path: 'pos', permissions: ['sales.pos.use'], story: 'HU-VEN-02' },
  { key: 'quotes', label: 'Cotizaciones', path: 'quotes', permissions: ['sales.quotes.manage'], story: 'HU-VEN-16' },
  { key: 'orders', label: 'Pedidos', path: 'orders', permissions: ['sales.orders.manage'], story: 'HU-VEN-19' },
  { key: 'history', label: 'Ventas realizadas', path: 'history', permissions: ['sales.pos.use'], story: 'HU-VEN-12' },
  { key: 'returns', label: 'Devoluciones', path: 'returns', permissions: ['sales.returns.manage'], story: 'HU-VEN-21' },
  { key: 'cash-register', label: 'Caja', path: 'cash-register', permissions: ['sales.cash-register.open'], story: 'HU-VEN-22' },
  { key: 'prices', label: 'Precios y descuentos', path: 'prices', permissions: ['sales.prices.edit'], story: 'HU-VEN-26' },
  {
    key: 'approvals',
    label: 'Aprobaciones',
    path: 'approvals',
    permissions: ['sales.cancellations.approve', 'sales.cash-register.review'],
    story: 'HU-VEN-29',
  },
];

export const canSeeSalesTab = (tab: SalesTab, can: (permission: string) => boolean): boolean => tab.permissions.some(can);
