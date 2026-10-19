import type { NavGroup } from '@rodasoft/ui';

/** Menú del ERP: 3 grupos como en la librería de Figma (Sidebar Current=…). */
export const ERP_NAV: NavGroup[] = [
  {
    label: 'Operación diaria',
    items: [
      { key: 'home', label: 'Inicio', icon: 'home', route: '/' },
      { key: 'sales', label: 'Ventas y POS', icon: 'sales', route: '/ventas' },
      { key: 'invoicing', label: 'Facturación', icon: 'invoicing', route: '/facturacion' },
      { key: 'inventory', label: 'Inventario', icon: 'inventory', route: '/inventario' },
      { key: 'purchases', label: 'Compras', icon: 'purchases', route: '/compras' },
    ],
  },
  {
    label: 'Clientes y finanzas',
    items: [
      { key: 'crm', label: 'CRM', icon: 'crm', route: '/crm' },
      { key: 'accounting', label: 'Contabilidad', icon: 'accounting', route: '/contabilidad' },
    ],
  },
  {
    label: 'Canales y control',
    items: [
      { key: 'store', label: 'Tienda en línea', icon: 'store', route: '/tienda' },
      { key: 'reports', label: 'Reportes', icon: 'reports', route: '/reportes' },
      { key: 'settings', label: 'Configuración', icon: 'settings', route: '/configuracion' },
    ],
  },
];
