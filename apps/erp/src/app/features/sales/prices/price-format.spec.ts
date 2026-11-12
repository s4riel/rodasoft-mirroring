import {
  applyLabel,
  brandLine,
  BULK_DIRECTIONS,
  BULK_ROUNDINGS,
  bulkSkipLabel,
  changeAuthor,
  formatMargin,
  formatPercent,
  formatSignedAmount,
  lastChangeText,
  matchCountText,
  parsePriced,
  priceStatusPill,
  skippedText,
} from './price-format';
import { priceChange } from './prices.testing';

describe('price formats (HU-VEN-26)', () => {
  it('signs a percent with the Bolivian comma', () => {
    expect(formatPercent('4.1')).toBe('+4,1 %');
    expect(formatPercent('-4.0')).toBe('−4,0 %');
    expect(formatPercent('0.0')).toBe('+0,0 %');
    expect(formatPercent(null)).toBe('');
    expect(formatPercent(undefined)).toBe('');
  });

  it('writes a margin, or a dash when there is none', () => {
    expect(formatMargin('38.5')).toBe('38,5 %');
    expect(formatMargin('-12.0')).toBe('−12,0 %');
    expect(formatMargin(null)).toBe('—');
    expect(formatMargin(undefined)).toBe('—');
  });

  it('signs the change in Bs', () => {
    expect(formatSignedAmount('10.00')).toBe('+ Bs 10,00');
    expect(formatSignedAmount('-1250.50')).toBe('− Bs 1.250,50');
    expect(formatSignedAmount('0.00')).toBe('Bs 0,00');
  });

  it('names who changed the price, or the imported list', () => {
    expect(changeAuthor(priceChange())).toBe('Gabriela Gerente');
    expect(changeAuthor(priceChange({ source: 'PRODUCT_FORM' }))).toBe('Gabriela Gerente');
    expect(changeAuthor(priceChange({ source: 'IMPORT' }))).toBe('lista importada');
    expect(changeAuthor(priceChange({ source: 'BULK' }))).toBe('actualización masiva');
    expect(changeAuthor(priceChange({ by: null }))).toBe('usuario eliminado');
  });

  it('writes "Última actualización" with the date in La Paz, the author and the percent', () => {
    expect(lastChangeText(priceChange())).toBe('14/10/2026 · Gabriela Gerente · +4,3 %');
    // 02:30 UTC on the 15th is still the 14th in La Paz
    expect(lastChangeText(priceChange({ at: '2026-10-15T02:30:00.000Z', source: 'IMPORT', percent: '-2.0' }))).toBe('14/10/2026 · lista importada · −2,0 %');
    // a product that had no price has no percent
    expect(lastChangeText(priceChange({ percent: null }))).toBe('14/10/2026 · Gabriela Gerente');
    expect(lastChangeText(null)).toBe('—');
  });

  it('writes the brand with the country when there is one', () => {
    expect(brandLine({ brand: { id: 'b', name: 'SKF' }, country: { code: 'SE', name: 'Suecia' } })).toBe('SKF · Suecia');
    expect(brandLine({ brand: { id: 'b', name: 'SKF' }, country: null })).toBe('SKF');
  });

  it('picks the status pill', () => {
    expect(priceStatusPill({ hasPrice: true, status: 'ACTIVE' })).toEqual({ label: 'Con precio', status: 'success' });
    expect(priceStatusPill({ hasPrice: false, status: 'ACTIVE' })).toEqual({ label: 'Sin precio', status: 'warning' });
    expect(priceStatusPill({ hasPrice: true, status: 'INACTIVE' })).toEqual({ label: 'Inactivo', status: 'idle' });
  });

  it('reads the "con o sin precio" filter from the URL', () => {
    expect(parsePriced('with')).toBe('with');
    expect(parsePriced('without')).toBe('without');
    expect(parsePriced('all')).toBeNull();
    expect(parsePriced(null)).toBeNull();
  });
});

describe('bulk update formats (HU-VEN-27)', () => {
  it('offers the two adjustments and the three roundings of the screen, in order', () => {
    expect(BULK_DIRECTIONS.map((d) => [d.value, d.label])).toEqual([
      ['INCREASE', 'Aumentar %'],
      ['DECREASE', 'Rebajar %'],
    ]);
    expect(BULK_ROUNDINGS.map((r) => [r.value, r.label])).toEqual([
      ['NONE', 'Sin redondeo'],
      ['HALF_BOLIVIANO', 'A Bs 0,50'],
      ['INTEGER', 'A Bs 1'],
    ]);
  });

  it('says why a product does not change', () => {
    expect(bulkSkipLabel('UNCHANGED')).toBe('Sin cambio');
    expect(bulkSkipLabel('INVALID')).toBe('Sin precio');
  });

  it('counts the matching products and labels the apply button', () => {
    expect(matchCountText(142)).toBe('142 productos coinciden con el filtro');
    expect(matchCountText(1)).toBe('1 producto coincide con el filtro');
    expect(matchCountText(0)).toBe('0 productos coinciden con el filtro');
    expect(applyLabel(142)).toBe('Aplicar a 142 productos');
    expect(applyLabel(1)).toBe('Aplicar a 1 producto');
  });

  it('describes the products that are left as they are', () => {
    expect(skippedText(0, 0)).toBe('');
    expect(skippedText(3, 0)).toBe('No se modifican: 3 con el mismo precio tras el ajuste.');
    expect(skippedText(0, 1)).toBe('No se modifican: 1 sin precio.');
    expect(skippedText(1, 2)).toBe('No se modifican: 1 con el mismo precio tras el ajuste y 2 sin precio.');
  });
});
