/**
 * Unique Invoice Code (CUF - Codigo Unico de Factura).
 *
 * Algorithm (SIN technical specification):
 *   1. Concatenate, left-padding with zeros:
 *      NIT(13) + DateTime(17, yyyyMMddHHmmssSSS) + Branch(4) + Modality(1) + EmissionType(1)
 *      + InvoiceDocumentType(1) + SectorDocumentType(2) + InvoiceNumber(10) + PointOfSale(4)  = 53 digits
 *   2. Compute the Modulo 11 check digit and append it (54 digits).
 *   3. Convert that decimal string to Base 16, upper case.
 *   4. Append the control code returned by the current CUFD.
 *
 * WARNING: before production, validate `buildCuf` against the official example in the SIN technical
 * document and add it as a case in cuf.spec.ts.
 */
export interface CufInput {
  nit: string | number;
  /** Issue date and time (converted to Bolivia time, UTC-4). */
  issuedAt: Date;
  branchCode: number;
  modalityCode: number;
  emissionType: number;
  invoiceDocumentType: number;
  sectorDocumentType: number;
  invoiceNumber: number | bigint;
  pointOfSaleCode: number;
  /** control code from the CUFD response */
  controlCode: string;
}

const pad = (v: string | number | bigint, len: number): string => {
  const s = String(v);
  if (!/^\d+$/.test(s)) throw new Error(`Non-numeric value for the CUF: "${s}"`);
  if (s.length > len) throw new Error(`"${s}" exceeds ${len} digits`);
  return s.padStart(len, '0');
};

/** Formats the date as yyyyMMddHHmmssSSS in Bolivia time (UTC-4, no daylight saving). */
export function formatSiatDate(date: Date): string {
  const bo = new Date(date.getTime() - 4 * 60 * 60 * 1000);
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return (
    bo.getUTCFullYear() +
    p(bo.getUTCMonth() + 1) +
    p(bo.getUTCDate()) +
    p(bo.getUTCHours()) +
    p(bo.getUTCMinutes()) +
    p(bo.getUTCSeconds()) +
    p(bo.getUTCMilliseconds(), 3)
  );
}

/** Local ISO format required by the invoice XML: 2026-10-14T10:24:00.000 (Bolivia time). */
export function formatXmlDate(date: Date): string {
  const s = formatSiatDate(date);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}.${s.slice(14)}`;
}

/**
 * Modulo 11 as defined by the SIN (weights 2..limMult from the right).
 * Returns `numDig` check digits.
 */
export function modulo11(chain: string, numDig = 1, limMult = 9, x10 = false): string {
  if (!/^\d+$/.test(chain)) throw new Error('modulo11 requires digits only');
  let work = chain;
  const digits = x10 ? numDig : 1;
  for (let n = 1; n <= digits; n++) {
    let sum = 0;
    let mult = 2;
    for (let i = work.length - 1; i >= 0; i--) {
      sum += mult * Number(work[i]);
      if (++mult > limMult) mult = 2;
    }
    const dig = x10 ? ((sum * 10) % 11) % 10 : sum % 11;
    work += dig === 10 ? '1' : dig === 11 ? '0' : String(dig);
  }
  return work.slice(work.length - digits);
}

/** Converts an arbitrarily long decimal string to upper-case base 16. */
export function base16(decimalString: string): string {
  return BigInt(decimalString).toString(16).toUpperCase();
}

export function cufChain(input: Omit<CufInput, 'controlCode'>): string {
  const chain =
    pad(input.nit, 13) +
    formatSiatDate(input.issuedAt) +
    pad(input.branchCode, 4) +
    pad(input.modalityCode, 1) +
    pad(input.emissionType, 1) +
    pad(input.invoiceDocumentType, 1) +
    pad(input.sectorDocumentType, 2) +
    pad(input.invoiceNumber, 10) +
    pad(input.pointOfSaleCode, 4);
  if (chain.length !== 53) throw new Error(`CUF string has ${chain.length} digits (53 expected)`);
  return chain;
}

export function buildCuf(input: CufInput): string {
  if (!input.controlCode) throw new Error('Missing CUFD control code');
  const chain = cufChain(input);
  const withCheckDigit = chain + modulo11(chain);
  return base16(withCheckDigit) + input.controlCode;
}
