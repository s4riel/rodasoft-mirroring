/**
 * Dinero en punto fijo con bigint. Nunca usar `number` para montos.
 *
 * - Montos de documentos (facturas, ventas, pagos): escala 2 (centavos).
 * - Costos unitarios, prorrateos y tipo de cambio: escala 4.
 * Redondeo: medio hacia arriba (HALF_UP), el usado en facturación.
 */
export type Currency = 'BOB' | 'USD';

export const MONEY_SCALE = 2;
export const COST_SCALE = 4;

const pow10 = (n: number): bigint => 10n ** BigInt(n);

export class Decimal {
  private constructor(
    /** valor entero escalado: 12.34 con escala 2 → 1234n */
    readonly units: bigint,
    readonly scale: number,
  ) {}

  static of(value: string | number | bigint, scale = MONEY_SCALE): Decimal {
    if (typeof value === 'bigint') return new Decimal(value * pow10(scale), scale);
    const text = typeof value === 'number' ? numberToPlain(value) : value.trim().replace(',', '.');
    if (!/^-?\d+(\.\d+)?$/.test(text)) throw new Error(`Monto inválido: "${value}"`);
    const negative = text.startsWith('-');
    const [intPart, fracPart = ''] = text.replace('-', '').split('.');
    const digits = BigInt(intPart + fracPart);
    const sourceScale = fracPart.length;
    const units = rescale(digits, sourceScale, scale);
    return new Decimal(negative ? -units : units, scale);
  }

  static zero(scale = MONEY_SCALE): Decimal {
    return new Decimal(0n, scale);
  }

  /** Construye desde unidades ya escaladas (p. ej. lo que se guarda en BD como entero). */
  static fromUnits(units: bigint, scale = MONEY_SCALE): Decimal {
    return new Decimal(units, scale);
  }

  add(other: Decimal): Decimal {
    const s = Math.max(this.scale, other.scale);
    return new Decimal(this.at(s) + other.at(s), s);
  }

  sub(other: Decimal): Decimal {
    const s = Math.max(this.scale, other.scale);
    return new Decimal(this.at(s) - other.at(s), s);
  }

  /** Multiplica y redondea a `scale` (por defecto la escala de este valor). */
  mul(factor: Decimal | string | number, scale = this.scale): Decimal {
    const f = factor instanceof Decimal ? factor : Decimal.of(factor, COST_SCALE);
    const raw = this.units * f.units; // escala this.scale + f.scale
    return new Decimal(rescale(raw, this.scale + f.scale, scale), scale);
  }

  /** Divide y redondea a `scale`. */
  div(divisor: Decimal | string | number, scale = this.scale): Decimal {
    const d = divisor instanceof Decimal ? divisor : Decimal.of(divisor, COST_SCALE);
    if (d.units === 0n) throw new Error('División entre cero');
    // (a / 10^sa) / (b / 10^sb) = a * 10^sb / (b * 10^sa) → escalar a `scale` con un dígito extra para redondear
    const numerator = this.units * pow10(d.scale + scale + 1);
    const denominator = d.units * pow10(this.scale);
    const q = numerator / denominator; // escala scale + 1, truncado
    return new Decimal(roundHalfUp(q, 1), scale);
  }

  /** Porcentaje: base × pct / 100 (p. ej. IVA 13 %, descuento del cliente). */
  percent(pct: Decimal | string | number, scale = this.scale): Decimal {
    return this.mul(pct, scale + 2).div(100, scale);
  }

  round(scale: number): Decimal {
    return new Decimal(rescale(this.units, this.scale, scale), scale);
  }

  neg(): Decimal {
    return new Decimal(-this.units, this.scale);
  }

  cmp(other: Decimal): -1 | 0 | 1 {
    const s = Math.max(this.scale, other.scale);
    const a = this.at(s);
    const b = other.at(s);
    return a === b ? 0 : a > b ? 1 : -1;
  }

  eq(other: Decimal): boolean {
    return this.cmp(other) === 0;
  }

  isZero(): boolean {
    return this.units === 0n;
  }

  isNegative(): boolean {
    return this.units < 0n;
  }

  /** "1280.00" — formato para BD (numeric), APIs y XML del SIAT. */
  toString(): string {
    const negative = this.units < 0n;
    const abs = negative ? -this.units : this.units;
    if (this.scale === 0) return `${negative ? '-' : ''}${abs}`;
    const s = abs.toString().padStart(this.scale + 1, '0');
    return `${negative ? '-' : ''}${s.slice(0, -this.scale)}.${s.slice(-this.scale)}`;
  }

  toJSON(): string {
    return this.toString();
  }

  /** "Bs 1.280,00" — formato de Bolivia para mostrar en pantalla e impresión. */
  format(currency: Currency = 'BOB'): string {
    const [int, frac] = this.toString().replace('-', '').split('.');
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const symbol = currency === 'BOB' ? 'Bs' : 'USD';
    return `${this.isNegative() ? '−' : ''}${symbol} ${grouped}${frac ? `,${frac}` : ''}`;
  }

  private at(scale: number): bigint {
    return this.units * pow10(scale - this.scale);
  }
}

/** Suma una lista de montos. */
export const sum = (values: Decimal[], scale = MONEY_SCALE): Decimal =>
  values.reduce((acc, v) => acc.add(v), Decimal.zero(scale)).round(scale);

/**
 * Reparte un monto en partes proporcionales a los pesos, sin perder centavos
 * (método del mayor resto). Se usa en el prorrateo de importaciones y descuentos globales.
 */
export function allocate(total: Decimal, weights: Decimal[]): Decimal[] {
  if (weights.length === 0) return [];
  const scale = total.scale;
  const sumWeights = weights.reduce((acc, w) => acc.add(w), Decimal.zero(COST_SCALE));
  if (sumWeights.isZero()) throw new Error('Los pesos del prorrateo suman cero');
  const ws = sumWeights.scale;
  const totalW = sumWeights.round(ws).units;
  const exact = weights.map((w) => total.units * w.round(ws).units);
  const base = exact.map((e) => e / totalW);
  let remainder = total.units - base.reduce((a, b) => a + b, 0n);
  const order = exact
    .map((e, i) => ({ i, rest: e % totalW }))
    .sort((a, b) => (a.rest === b.rest ? a.i - b.i : a.rest > b.rest ? -1 : 1));
  for (const { i } of order) {
    if (remainder <= 0n) break;
    base[i] += 1n;
    remainder -= 1n;
  }
  return base.map((u) => Decimal.fromUnits(u, scale));
}

function rescale(units: bigint, from: number, to: number): bigint {
  if (to === from) return units;
  if (to > from) return units * pow10(to - from);
  return roundHalfUp(units, from - to);
}

function roundHalfUp(units: bigint, dropDigits: number): bigint {
  const p = pow10(dropDigits);
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const q = abs / p;
  const r = abs % p;
  const rounded = r * 2n >= p ? q + 1n : q;
  return negative ? -rounded : rounded;
}

function numberToPlain(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Monto inválido: ${n}`);
  // evita notación científica (1e-7) y errores de coma flotante largos
  return n.toFixed(10).replace(/\.?0+$/, '');
}
