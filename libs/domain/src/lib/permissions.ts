/**
 * Catálogo de permisos del ERP. Formato `<modulo>.<recurso>.<accion>`.
 * La fuente de verdad es este archivo: el seed los inserta en BD, el backend los exige
 * con @RequirePermissions() y el ERP oculta botones con *rsCan.
 */
export const PERMISSIONS = {
  // Base común / configuración
  'config.empresa.ver': 'Ver datos de la empresa',
  'config.empresa.editar': 'Editar datos de la empresa',
  'config.usuarios.ver': 'Ver usuarios',
  'config.usuarios.gestionar': 'Invitar, desactivar y asignar roles',
  'config.roles.gestionar': 'Crear y editar roles',
  'config.sucursales.gestionar': 'Gestionar sucursales y almacenes',
  'auditoria.ver': 'Ver registro de auditoría',

  // Inventario
  'inventario.productos.ver': 'Ver productos y stock',
  'inventario.productos.editar': 'Crear y editar productos',
  'inventario.costos.ver': 'Ver costos',
  'inventario.ajustes.crear': 'Registrar ajustes de inventario',
  'inventario.ajustes.aprobar': 'Aprobar ajustes de inventario',
  'inventario.transferencias.crear': 'Crear transferencias',
  'inventario.transferencias.aprobar': 'Aprobar transferencias sobre el límite',
  'inventario.transferencias.recibir': 'Recibir transferencias',
  'inventario.importar': 'Importar productos desde Excel',

  // Ventas y POS
  'ventas.pos.usar': 'Vender en el punto de venta',
  'ventas.caja.abrir': 'Abrir y cerrar caja',
  'ventas.caja.revisar': 'Revisar diferencias de caja',
  'ventas.cotizaciones.gestionar': 'Gestionar cotizaciones',
  'ventas.pedidos.gestionar': 'Gestionar pedidos',
  'ventas.descuentos.aplicar': 'Aplicar descuentos dentro del límite del rol',
  'ventas.descuentos.aprobar': 'Aprobar descuentos fuera del límite',
  'ventas.anulaciones.solicitar': 'Solicitar anulación de una venta',
  'ventas.anulaciones.aprobar': 'Aprobar anulaciones',
  'ventas.devoluciones.gestionar': 'Registrar devoluciones',
  'ventas.precios.editar': 'Editar precios',

  // Facturación SIAT
  'facturacion.facturas.ver': 'Ver facturas',
  'facturacion.facturas.emitir': 'Emitir facturas',
  'facturacion.notas.emitir': 'Emitir notas de crédito y débito',
  'facturacion.contingencia.gestionar': 'Activar contingencia y regularizar',
  'facturacion.excepcion-nit.aprobar': 'Aprobar emisión con excepción de NIT',
  'facturacion.configuracion.gestionar': 'Firma, credenciales, puntos de venta y homologación',
  'facturacion.libros.ver': 'Ver libros IVA',
  'facturacion.libros.cerrar': 'Cerrar períodos',

  // Compras
  'compras.proveedores.gestionar': 'Gestionar proveedores',
  'compras.ordenes.crear': 'Crear órdenes de compra',
  'compras.ordenes.aprobar': 'Aprobar órdenes de compra',
  'compras.recepcion.registrar': 'Registrar recepciones',
  'compras.importaciones.gestionar': 'Gestionar importaciones y prorrateo',
  'compras.facturas.registrar': 'Registrar facturas de compra',
  'compras.pagos.gestionar': 'Programar y registrar pagos',

  // CRM
  'crm.clientes.ver': 'Ver clientes',
  'crm.clientes.gestionar': 'Crear y editar clientes',
  'crm.creditos.aprobar': 'Aprobar líneas de crédito',
  'crm.oportunidades.gestionar': 'Gestionar oportunidades y seguimiento',

  // Contabilidad
  'contabilidad.asientos.ver': 'Ver asientos y libros',
  'contabilidad.asientos.crear': 'Registrar asientos manuales',
  'contabilidad.bancos.conciliar': 'Conciliar bancos',
  'contabilidad.cierres.gestionar': 'Cerrar períodos contables',

  // Tienda y reportes
  'tienda.pedidos.gestionar': 'Gestionar pedidos en línea',
  'tienda.contenido.gestionar': 'Gestionar catálogo y contenido web',
  'reportes.ver': 'Ver reportes',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

const byPrefix = (...prefixes: string[]): Permission[] =>
  ALL_PERMISSIONS.filter((p) => prefixes.some((prefix) => p.startsWith(prefix)));

/** Roles iniciales (se pueden editar en Configuración → Roles). Pendiente de validar con el cliente. */
export const DEFAULT_ROLES: Record<string, { nombre: string; permisos: Permission[] }> = {
  admin: { nombre: 'Administrador', permisos: ALL_PERMISSIONS },
  gerencia: {
    nombre: 'Gerencia',
    permisos: ALL_PERMISSIONS.filter((p) => !p.startsWith('config.roles')),
  },
  cajero: {
    nombre: 'Cajero',
    permisos: [
      'inventario.productos.ver',
      'ventas.pos.usar',
      'ventas.caja.abrir',
      'ventas.cotizaciones.gestionar',
      'ventas.pedidos.gestionar',
      'ventas.descuentos.aplicar',
      'ventas.anulaciones.solicitar',
      'ventas.devoluciones.gestionar',
      'facturacion.facturas.ver',
      'facturacion.facturas.emitir',
      'crm.clientes.ver',
    ],
  },
  almacen: {
    nombre: 'Almacén',
    permisos: ([...byPrefix('inventario.'), 'compras.recepcion.registrar'] as Permission[]).filter(
      (p) => !['inventario.costos.ver', 'inventario.ajustes.aprobar', 'inventario.transferencias.aprobar'].includes(p),
    ),
  },
  contador: {
    nombre: 'Contador',
    permisos: [
      ...byPrefix('contabilidad.', 'facturacion.'),
      'compras.facturas.registrar',
      'compras.pagos.gestionar',
      'ventas.caja.revisar',
      'inventario.productos.ver',
      'inventario.costos.ver',
      'reportes.ver',
    ],
  },
};

export function hasAll(granted: Iterable<string>, required: Permission[]): boolean {
  const set = new Set(granted);
  return required.every((p) => set.has(p));
}
