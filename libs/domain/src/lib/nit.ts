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

export type DocumentErrorKind = 'REQUIRED' | 'FORMAT' | 'COMPLEMENT';

export type DocumentValidation =
  | { valid: true; documentNumber: string; complement: string | null }
  | { valid: false; error: DocumentErrorKind };

const DIGITS = /^\d+$/;
const ALPHANUMERIC = /^[0-9A-Z]+$/;

/** A Bolivian CI has up to two characters of complement ("1A") to tell apart two people with the same number. */
const COMPLEMENT = /^[0-9A-Z]{1,2}$/;

/**
 * FORMAT check of the customer's identity document before invoicing (HU-VEN-05). Returns the normalized number
 * (spaces, dots and dashes removed; letters upper-cased). Whether the SIN knows a NIT is a separate, online check
 * (`sales.nitVerification`, HU-FAC), so this never says a NIT "exists".
 */
export function validateInvoiceDocument(type: number, number: string, complement?: string | null): DocumentValidation {
  const raw = normalizeNit(number ?? '').toUpperCase();
  if (!raw) return { valid: false, error: 'REQUIRED' };
  const extra = (complement ?? '').trim().toUpperCase();
  if (extra && type !== IdentityDocumentType.CI) return { valid: false, error: 'COMPLEMENT' };
  if (extra && !COMPLEMENT.test(extra)) return { valid: false, error: 'COMPLEMENT' };

  let ok: boolean;
  switch (type) {
    case IdentityDocumentType.NIT:
      ok = isNitFormatValid(raw);
      break;
    case IdentityDocumentType.CI:
      ok = DIGITS.test(raw) && raw.length >= 5 && raw.length <= 10 && !/^0+$/.test(raw);
      break;
    case IdentityDocumentType.CEX:
      ok = ALPHANUMERIC.test(raw) && raw.length >= 5 && raw.length <= 15;
      break;
    case IdentityDocumentType.PAS:
    case IdentityDocumentType.OD:
      ok = ALPHANUMERIC.test(raw) && raw.length >= 4 && raw.length <= 20;
      break;
    default:
      ok = false;
  }
  return ok ? { valid: true, documentNumber: raw, complement: extra || null } : { valid: false, error: 'FORMAT' };
}
