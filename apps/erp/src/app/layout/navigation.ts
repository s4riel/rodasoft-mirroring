import type { NavGroup } from '@rodasoft/ui';

/** ERP menu: 3 groups as in the Figma library (Sidebar Current=…). */
export const ERP_NAV: NavGroup[] = [
  {
    label: 'Operación diaria',
    items: [
      { key: 'home', label: 'Inicio', icon: 'home', route: '/' },
      { key: 'sales', label: 'Ventas y POS', icon: 'cart', route: '/sales' },
      { key: 'invoicing', label: 'Facturación', icon: 'invoice', route: '/invoicing' },
      { key: 'inventory', label: 'Inventario', icon: 'inventory', route: '/inventory' },
      { key: 'purchasing', label: 'Compras', icon: 'purchases', route: '/purchasing' },
    ],
  },
  {
    label: 'Clientes y finanzas',
    items: [
      { key: 'crm', label: 'CRM', icon: 'user', route: '/crm' },
      { key: 'accounting', label: 'Contabilidad', icon: 'accounting', route: '/accounting' },
    ],
  },
  {
    label: 'Canales y control',
    items: [
      { key: 'store', label: 'Tienda en línea', icon: 'store', route: '/store' },
      { key: 'reports', label: 'Reportes', icon: 'reports', route: '/reports' },
      { key: 'settings', label: 'Configuración', icon: 'settings', route: '/settings' },
    ],
  },
];
