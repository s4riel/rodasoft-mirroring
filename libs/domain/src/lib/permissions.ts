/**
 * ERP permission catalog. Key format: `<module>.<resource>.<action>`.
 * This file is the source of truth: the seed inserts the keys into the DB, the backend enforces
 * them with @RequirePermissions() and the ERP hides actions with *rsCan.
 * Values are the Spanish labels shown in the Roles screen (UI content).
 */
export const PERMISSIONS = {
  // Settings and audit
  'settings.company.view': 'Ver datos de la empresa',
  'settings.company.edit': 'Editar datos de la empresa',
  'settings.users.view': 'Ver usuarios',
  'settings.users.manage': 'Invitar, desactivar y asignar roles',
  'settings.roles.manage': 'Crear y editar roles',
  'settings.branches.manage': 'Gestionar sucursales y almacenes',
  'audit.view': 'Ver registro de auditoría',

  // Inventory
  'inventory.products.view': 'Ver productos y stock',
  'inventory.products.edit': 'Crear y editar productos',
  'inventory.products.delete': 'Eliminar productos',
  'inventory.costs.view': 'Ver costos',
  'inventory.adjustments.create': 'Registrar ajustes de inventario',
  'inventory.adjustments.approve': 'Aprobar ajustes de inventario',
  'inventory.transfers.create': 'Crear transferencias',
  'inventory.transfers.approve': 'Aprobar transferencias sobre el límite',
  'inventory.transfers.receive': 'Recibir transferencias',
  'inventory.products.import': 'Importar productos desde Excel',
  'inventory.products.export': 'Exportar productos a Excel',

  // Sales and POS
  'sales.pos.use': 'Vender en el punto de venta',
  'sales.cash-register.open': 'Abrir y cerrar caja',
  'sales.cash-register.review': 'Revisar diferencias de caja',
  'sales.quotes.manage': 'Gestionar cotizaciones',
  'sales.orders.manage': 'Gestionar pedidos',
  'sales.discounts.apply': 'Aplicar descuentos dentro del límite del rol',
  'sales.discounts.approve': 'Aprobar descuentos fuera del límite',
  'sales.cancellations.request': 'Solicitar anulación de una venta',
  'sales.cancellations.approve': 'Aprobar anulaciones',
  'sales.returns.manage': 'Registrar devoluciones',
  'sales.prices.edit': 'Editar precios',

  // SIAT invoicing
  'invoicing.invoices.view': 'Ver facturas',
  'invoicing.invoices.issue': 'Emitir facturas',
  'invoicing.notes.issue': 'Emitir notas de crédito y débito',
  'invoicing.contingency.manage': 'Activar contingencia y regularizar',
  'invoicing.nit-exception.approve': 'Aprobar emisión con excepción de NIT',
  'invoicing.settings.manage': 'Firma, credenciales, puntos de venta y homologación',
  'invoicing.vat-books.view': 'Ver libros IVA',
  'invoicing.vat-books.close': 'Cerrar períodos',

  // Purchasing
  'purchasing.suppliers.manage': 'Gestionar proveedores',
  'purchasing.orders.create': 'Crear órdenes de compra',
  'purchasing.orders.approve': 'Aprobar órdenes de compra',
  'purchasing.receipts.record': 'Registrar recepciones',
  'purchasing.imports.manage': 'Gestionar importaciones y prorrateo',
  'purchasing.invoices.record': 'Registrar facturas de compra',
  'purchasing.payments.manage': 'Programar y registrar pagos',

  // CRM
  'crm.customers.view': 'Ver clientes',
  'crm.customers.manage': 'Crear y editar clientes',
  'crm.credit.approve': 'Aprobar líneas de crédito',
  'crm.opportunities.manage': 'Gestionar oportunidades y seguimiento',

  // Accounting
  'accounting.entries.view': 'Ver asientos y libros',
  'accounting.entries.create': 'Registrar asientos manuales',
  'accounting.banks.reconcile': 'Conciliar bancos',
  'accounting.closings.manage': 'Cerrar períodos contables',

  // Store and reports
  'store.orders.manage': 'Gestionar pedidos en línea',
  'store.content.manage': 'Gestionar catálogo y contenido web',
  'reports.view': 'Ver reportes',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

const byPrefix = (...prefixes: string[]): Permission[] =>
  ALL_PERMISSIONS.filter((p) => prefixes.some((prefix) => p.startsWith(prefix)));

/** Default roles (editable in Settings → Roles). Pending validation with the client. `name` is the Spanish display name. */
export const DEFAULT_ROLES: Record<string, { name: string; permissions: Permission[] }> = {
  admin: { name: 'Administrador', permissions: ALL_PERMISSIONS },
  management: {
    name: 'Gerencia',
    permissions: ALL_PERMISSIONS.filter((p) => !p.startsWith('settings.roles')),
  },
  cashier: {
    name: 'Cajero',
    permissions: [
      'inventory.products.view',
      'sales.pos.use',
      'sales.cash-register.open',
      'sales.quotes.manage',
      'sales.orders.manage',
      'sales.discounts.apply',
      'sales.cancellations.request',
      'sales.returns.manage',
      'invoicing.invoices.view',
      'invoicing.invoices.issue',
      'crm.customers.view',
    ],
  },
  warehouse: {
    name: 'Almacén',
    permissions: ([...byPrefix('inventory.'), 'purchasing.receipts.record'] as Permission[]).filter(
      (p) => !['inventory.costs.view', 'inventory.adjustments.approve', 'inventory.transfers.approve'].includes(p),
    ),
  },
  accountant: {
    name: 'Contador',
    permissions: [
      ...byPrefix('accounting.', 'invoicing.'),
      'purchasing.invoices.record',
      'purchasing.payments.manage',
      'sales.cash-register.review',
      'inventory.products.view',
      'inventory.costs.view',
      'reports.view',
    ],
  },
};

export function hasAll(granted: Iterable<string>, required: Permission[]): boolean {
  const set = new Set(granted);
  return required.every((p) => set.has(p));
}
