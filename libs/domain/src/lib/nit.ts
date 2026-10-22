/**
 * FORMAT validation of the Bolivian NIT/CI. Real validity (whether the SIN recognizes it)
 * is checked online with the SIAT `verificarNit` service (screens FS-20/FS-21).
 */
export function normalizeNit(value: string | number): string {
  return String(value).replace(/[\s.-]/g, '');
}

export function isNitFormatValid(value: string | number): boolean {
  const nit = normalizeNit(value);
  return /^\d{5,13}$/.test(nit) && !/^0+$/.test(nit);
}

/** Identity document types (SIN catalog `sincronizarParametricaIdentityDocumentType`). */
export enum IdentityDocumentType {
  CI = 1,
  CEX = 2,
  PAS = 3,
  OD = 4,
  NIT = 5,
}
