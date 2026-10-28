import { fieldIconOf, type ProductSpec } from '@rodasoft/domain';
import { formatBoliviano, type IconName } from '@rodasoft/ui';
import { formatMeasure } from '../product-list.mapper';

const TIME_ZONE = 'America/La_Paz';

/** "2026-10-22T14:05:00Z" -> "22 oct 2026" in the business timezone. */
export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('es-BO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TIME_ZONE })
    .format(new Date(iso))
    .replace(/\./g, '');
}

/** "12.500" -> "12,5 mm"; null stays as an en dash so the field keeps its place. */
export function formatMillimeters(value: string | null): string {
  return value ? `${formatMeasure(value)} mm` : '–';
}

export function formatKilograms(value: string | null): string {
  return value ? `${formatMeasure(value)} kg` : '–';
}

/** "245.00" -> "Bs 245,00" (same format as the list); a missing amount stays as an en dash. */
export function formatMoney(amount: string | null | undefined): string {
  return amount ? `Bs ${formatBoliviano(amount)}` : '–';
}

/** "26.5" -> "26,5 %" (Figma writes a space before the sign). */
export function formatPercent(value: string | null | undefined): string {
  return value ? `${value.replace('.', ',')} %` : '–';
}

const UNIT_NAMES: Record<string, string> = {
  UN: 'Piezas',
  PAR: 'Pares',
  JGO: 'Juegos',
  M: 'Metros',
  KG: 'Kilogramos',
  LT: 'Litros',
};

/** Unit code to its display name, in plural as it reads in "Unidad de medida" ("UN" -> "Piezas"); other codes are shown as they are. */
export function formatUnit(unit: string): string {
  return UNIT_NAMES[unit] ?? unit;
}

const UNIT_FORMS: Record<string, readonly [one: string, many: string]> = {
  UN: ['pieza', 'piezas'],
  PAR: ['par', 'pares'],
  JGO: ['juego', 'juegos'],
  M: ['metro', 'metros'],
  KG: ['kilogramo', 'kilogramos'],
  LT: ['litro', 'litros'],
};

/** A quantity with the unit of the product, in the form that matches the count: "1 pieza", "121 piezas", "4 pares". */
export function formatQuantity(n: number, unit: string | null | undefined): string {
  const forms = unit ? UNIT_FORMS[unit] : undefined;
  if (forms) return `${n} ${plural(n, forms[0], forms[1])}`;
  return `${n} ${unit || 'uds'}`;
}

/** Last path segment of a URL, decoded ("https://x/a/SKF%20x.pdf" -> "SKF x.pdf"). */
export function fileNameOf(url: string): string {
  const last = url.split('?')[0].split('/').filter(Boolean).pop() ?? url;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** "1 sucursal" / "2 sucursales": the form that matches the count. */
export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** The shared value of a per-branch setting, `null` when none is set and `mixed` when branches differ. */
export function uniformValue<T extends string | number>(values: readonly (T | null)[]): T | null | 'mixed' {
  const set = new Set(values.filter((v): v is T => v !== null));
  if (set.size === 0) return null;
  return set.size === 1 ? [...set][0] : 'mixed';
}

export interface SpecField {
  key: string;
  label: string;
  icon: IconName;
  value: string;
  mono: boolean;
}

/** Display value of a specification: numbers and units in es-BO, booleans as Sí / No, missing values as "–". */
export function specValue(spec: ProductSpec): string {
  if (spec.value === null) return '–';
  if (typeof spec.value === 'boolean') return spec.value ? 'Sí' : 'No';
  const text = typeof spec.value === 'number' ? spec.value.toLocaleString('es-BO') : spec.value;
  return spec.unit ? `${text} ${spec.unit}` : text;
}

export function toSpecField(spec: ProductSpec): SpecField {
  return {
    key: spec.key,
    label: spec.label,
    icon: fieldIconOf({ type: spec.type, unit: spec.unit, key: spec.key }),
    value: specValue(spec),
    mono: spec.type === 'NUMBER',
  };
}
