import type { ProductSpec } from '@rodasoft/domain';
import {
  formatDate,
  formatKilograms,
  formatMillimeters,
  formatMoney,
  fileNameOf,
  formatPercent,
  formatQuantity,
  formatUnit,
  specValue,
  toSpecField,
  uniformValue,
} from './product-sheet.mapper';

const spec = (over: Partial<ProductSpec>): ProductSpec => ({
  key: 'k',
  step: 3,
  label: 'Campo',
  type: 'TEXT',
  unit: null,
  value: null,
  ...over,
});

describe('product sheet mapper', () => {
  it('formats measures with the es-BO decimal comma', () => {
    expect(formatMillimeters('25.000')).toBe('25 mm');
    expect(formatMillimeters('16.250')).toBe('16,25 mm');
    expect(formatMillimeters(null)).toBe('–');
    expect(formatKilograms('0.130')).toBe('0,13 kg');
  });

  it('formats money like the list and keeps a missing amount as an en dash', () => {
    expect(formatMoney('1150.50')).toBe('Bs 1.150,50');
    expect(formatMoney('147.0000')).toBe('Bs 147,00');
    expect(formatMoney(null)).toBe('–');
    expect(formatMoney(undefined)).toBe('–');
    expect(formatPercent('26.5')).toBe('26,5 %');
    expect(formatPercent(null)).toBe('–');
  });

  it('writes a quantity with the unit of the product, singular or plural', () => {
    expect(formatQuantity(1, 'UN')).toBe('1 pieza');
    expect(formatQuantity(121, 'UN')).toBe('121 piezas');
    expect(formatQuantity(0, 'UN')).toBe('0 piezas');
    expect(formatQuantity(1, 'PAR')).toBe('1 par');
    expect(formatQuantity(4, 'PAR')).toBe('4 pares');
    expect(formatQuantity(12, 'KG')).toBe('12 kilogramos');
    expect(formatQuantity(3, 'XYZ')).toBe('3 XYZ');
    expect(formatQuantity(3, '')).toBe('3 uds');
    expect(formatQuantity(3, undefined)).toBe('3 uds');
  });

  it('names units, files and shared per-branch values', () => {
    expect(formatUnit('UN')).toBe('Piezas');
    expect(formatUnit('M')).toBe('Metros');
    expect(formatUnit('JGO')).toBe('Juegos');
    expect(formatUnit('XYZ')).toBe('XYZ');
    expect(fileNameOf('https://x.test/files/SKF%206205.pdf?v=2')).toBe('SKF 6205.pdf');
    expect(uniformValue([6, 6, null])).toBe(6);
    expect(uniformValue([6, 8])).toBe('mixed');
    expect(uniformValue<number>([null, null])).toBeNull();
    expect(uniformValue(['A-03', 'A-03'])).toBe('A-03');
  });

  it('formats dates in the business timezone', () => {
    // 01:30 UTC is still the previous day in La Paz (UTC-4)
    expect(formatDate('2026-10-22T01:30:00Z')).toContain('21');
    expect(formatDate('2026-10-22T15:00:00Z')).toContain('22');
    expect(formatDate('2026-10-22T15:00:00Z')).toContain('2026');
  });

  it('shows a specification value with its unit, Sí / No for booleans and an en dash when missing', () => {
    expect(specValue(spec({ type: 'NUMBER', unit: 'kN', value: 14 }))).toBe('14 kN');
    expect(specValue(spec({ type: 'ENUM', value: '2RS' }))).toBe('2RS');
    expect(specValue(spec({ type: 'BOOLEAN', value: true }))).toBe('Sí');
    expect(specValue(spec({ type: 'BOOLEAN', value: false }))).toBe('No');
    expect(specValue(spec({ value: null }))).toBe('–');
  });

  it('gives every specification an icon by data type and monospaces numbers', () => {
    expect(toSpecField(spec({ type: 'ENUM', value: '2RS' }))).toMatchObject({ icon: 'tag', mono: false });
    expect(toSpecField(spec({ type: 'NUMBER', unit: 'mm', key: 'minRadius', value: 1 }))).toMatchObject({
      icon: 'diameter',
      mono: true,
    });
    expect(toSpecField(spec({ type: 'TEXT', value: 'x' })).icon).toBe('info');
  });
});
