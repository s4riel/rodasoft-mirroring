/**
 * Validación de FORMATO del NIT/CI boliviano. La validez real (si el SIN lo reconoce)
 * se consulta en línea con el servicio `verificarNit` del SIAT (pantallas FS-20/FS-21).
 */
export function normalizeNit(value: string | number): string {
  return String(value).replace(/[\s.-]/g, '');
}

export function isNitFormatValid(value: string | number): boolean {
  const nit = normalizeNit(value);
  return /^\d{5,13}$/.test(nit) && !/^0+$/.test(nit);
}

/** Tipos de documento de identidad (catálogo SIN `sincronizarParametricaTipoDocumentoIdentidad`). */
export enum TipoDocumentoIdentidad {
  CI = 1,
  CEX = 2,
  PAS = 3,
  OD = 4,
  NIT = 5,
}
