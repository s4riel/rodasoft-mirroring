/**
 * Código Único de Factura (CUF).
 *
 * Algoritmo (especificación técnica del SIN):
 *   1. Concatenar, rellenando con ceros a la izquierda:
 *      NIT(13) + FechaHora(17, yyyyMMddHHmmssSSS) + Sucursal(4) + Modalidad(1) + TipoEmision(1)
 *      + TipoFacturaDocumento(1) + TipoDocumentoSector(2) + NumeroFactura(10) + PuntoVenta(4)  = 53 dígitos
 *   2. Calcular el dígito verificador Módulo 11 y agregarlo al final (54 dígitos).
 *   3. Convertir esa cadena (número decimal) a Base 16, en mayúsculas.
 *   4. Concatenar el Código de Control que devuelve el CUFD vigente.
 *
 * ⚠ Antes de producción, validar `buildCuf` contra el ejemplo oficial del documento técnico del SIN
 *   y agregarlo como caso en cuf.spec.ts.
 */
export interface CufInput {
  nit: string | number;
  /** Fecha y hora de emisión en hora de Bolivia (UTC-4). */
  fechaEmision: Date;
  codigoSucursal: number;
  codigoModalidad: number;
  tipoEmision: number;
  tipoFacturaDocumento: number;
  tipoDocumentoSector: number;
  numeroFactura: number | bigint;
  codigoPuntoVenta: number;
  /** codigoControl de la respuesta del CUFD */
  codigoControl: string;
}

const pad = (v: string | number | bigint, len: number): string => {
  const s = String(v);
  if (!/^\d+$/.test(s)) throw new Error(`Valor no numérico para el CUF: "${s}"`);
  if (s.length > len) throw new Error(`"${s}" excede ${len} dígitos`);
  return s.padStart(len, '0');
};

/** Formatea la fecha como yyyyMMddHHmmssSSS en la zona horaria de Bolivia (UTC-4, sin horario de verano). */
export function formatFechaSiat(date: Date): string {
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

/** Formato ISO local que exige el XML de la factura: 2026-10-14T10:24:00.000 (hora de Bolivia). */
export function formatFechaXml(date: Date): string {
  const s = formatFechaSiat(date);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}.${s.slice(14)}`;
}

/**
 * Módulo 11 tal como lo define el SIN (pesos 2..limMult desde la derecha).
 * Devuelve `numDig` dígitos verificadores.
 */
export function modulo11(cadena: string, numDig = 1, limMult = 9, x10 = false): string {
  if (!/^\d+$/.test(cadena)) throw new Error('modulo11 requiere solo dígitos');
  let work = cadena;
  const digits = x10 ? numDig : 1;
  for (let n = 1; n <= digits; n++) {
    let suma = 0;
    let mult = 2;
    for (let i = work.length - 1; i >= 0; i--) {
      suma += mult * Number(work[i]);
      if (++mult > limMult) mult = 2;
    }
    const dig = x10 ? ((suma * 10) % 11) % 10 : suma % 11;
    work += dig === 10 ? '1' : dig === 11 ? '0' : String(dig);
  }
  return work.slice(work.length - digits);
}

/** Convierte una cadena decimal arbitrariamente larga a base 16 en mayúsculas. */
export function base16(decimalString: string): string {
  return BigInt(decimalString).toString(16).toUpperCase();
}

export function cufCadena(input: Omit<CufInput, 'codigoControl'>): string {
  const cadena =
    pad(input.nit, 13) +
    formatFechaSiat(input.fechaEmision) +
    pad(input.codigoSucursal, 4) +
    pad(input.codigoModalidad, 1) +
    pad(input.tipoEmision, 1) +
    pad(input.tipoFacturaDocumento, 1) +
    pad(input.tipoDocumentoSector, 2) +
    pad(input.numeroFactura, 10) +
    pad(input.codigoPuntoVenta, 4);
  if (cadena.length !== 53) throw new Error(`Cadena CUF de ${cadena.length} dígitos (se esperaban 53)`);
  return cadena;
}

export function buildCuf(input: CufInput): string {
  if (!input.codigoControl) throw new Error('Falta el código de control del CUFD');
  const cadena = cufCadena(input);
  const conVerificador = cadena + modulo11(cadena);
  return base16(conVerificador) + input.codigoControl;
}
