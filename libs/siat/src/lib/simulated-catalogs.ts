import type { SiatCatalogs } from './gateway';

/**
 * The SIN parametric tables the simulator answers with (`sincronizar*` of the real service). A fixed fixture: the shapes and codes
 * are plausible but NOT copied from the SIN, so they must be replaced by the synced ones with the real adapter (HU-FAC-22…26).
 */
export const SIMULATED_CATALOGS: SiatCatalogs = {
  ACTIVITY: [
    { code: '465900', description: 'VENTA AL POR MAYOR DE OTROS TIPOS DE MAQUINARIA Y EQUIPO' },
    { code: '466900', description: 'VENTA AL POR MAYOR DE OTROS PRODUCTOS N.C.P.' },
    { code: '474100', description: 'VENTA AL POR MENOR DE REPUESTOS Y ACCESORIOS' },
  ],
  LEGEND: [
    { code: '1', activityCode: '465900', description: 'Ley N° 453: Tienes derecho a recibir información sobre las características y contenidos de los servicios que utilices.' },
    { code: '2', activityCode: '465900', description: 'Ley N° 453: El proveedor deberá brindar atención sin discriminación, con respeto, calidez y cordialidad a los usuarios y consumidores.' },
    { code: '3', activityCode: '466900', description: 'Ley N° 453: Está prohibido importar, distribuir o comercializar productos expirados o prontos a expirar.' },
    { code: '4', activityCode: '474100', description: 'Ley N° 453: Puedes acceder a la reclamación cuando tus derechos han sido vulnerados.' },
  ],
  PRODUCT_SERVICE: [
    { code: '84821', activityCode: '465900', description: 'RODAMIENTOS DE BOLAS' },
    { code: '84822', activityCode: '465900', description: 'RODAMIENTOS DE RODILLOS' },
    { code: '84829', activityCode: '465900', description: 'PARTES Y PIEZAS DE RODAMIENTOS' },
    { code: '40169', activityCode: '466900', description: 'RETENES Y SELLOS DE CAUCHO' },
    { code: '40101', activityCode: '466900', description: 'CORREAS Y POLEAS DE TRANSMISION' },
    { code: '73151', activityCode: '466900', description: 'CADENAS Y PIÑONES DE TRANSMISION' },
    { code: '27101', activityCode: '466900', description: 'LUBRICANTES Y GRASAS INDUSTRIALES' },
    { code: '82050', activityCode: '474100', description: 'HERRAMIENTAS DE MANO' },
    { code: '84833', activityCode: '465900', description: 'ACOPLES Y ACCESORIOS DE TRANSMISION' },
    { code: '99100', activityCode: '466900', description: 'OTROS PRODUCTOS N.C.P.' },
  ],
  UNIT_OF_MEASURE: [
    { code: '58', description: 'UNIDAD (BIENES)' },
    { code: '57', description: 'UNIDAD (SERVICIOS)' },
    { code: '62', description: 'PAR' },
    { code: '22', description: 'KILOGRAMO' },
    { code: '47', description: 'LITRO' },
    { code: '25', description: 'METRO' },
  ],
  CANCELLATION_REASON: [
    { code: '1', description: 'Factura mal emitida' },
    { code: '2', description: 'Nota de crédito-débito mal emitida' },
    { code: '3', description: 'Datos de emisión incorrectos' },
    { code: '4', description: 'Factura o nota de crédito-débito devuelta' },
  ],
  CREDIT_NOTE_REASON: [
    { code: '1', description: 'Devolución de mercadería' },
    { code: '2', description: 'Producto con falla de fábrica' },
    { code: '3', description: 'Producto equivocado' },
    { code: '4', description: 'Ajuste de precio' },
    { code: '5', description: 'Otro' },
  ],
  POINT_OF_SALE_TYPE: [
    { code: '1', description: 'Comisionista' },
    { code: '2', description: 'Ventanilla de cobranza' },
    { code: '5', description: 'Caja de sucursal' },
  ],
};
