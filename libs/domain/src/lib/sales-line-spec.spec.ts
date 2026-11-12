import { formatMeasures, salesLineSpecText, type SalesLineSpec } from './sales-line-spec';

const spec = (over: Partial<SalesLineSpec> = {}): SalesLineSpec => ({
  measures: { innerDiameter: '25.00', outerDiameter: '52.00', width: '15.00' },
  category: 'Rodamientos',
  subcategory: 'Rígidos de bolas',
  details: ['Sello: 2RS', 'Material: Acero', 'Jaula: Metal'],
  ...over,
});

describe('formatMeasures', () => {
  it('writes d × D × B in mm without trailing zeros and with a decimal comma', () => {
    expect(formatMeasures({ innerDiameter: '25.00', outerDiameter: '52.00', width: '15.00' })).toBe('25 × 52 × 15 mm');
    expect(formatMeasures({ innerDiameter: '40', outerDiameter: '80', width: '19.25' })).toBe('40 × 80 × 19,25 mm');
  });

  it('gives null while one measure is missing', () => {
    expect(formatMeasures(null)).toBeNull();
    expect(formatMeasures({ innerDiameter: '25', outerDiameter: null, width: '15' })).toBeNull();
  });
});

describe('salesLineSpecText', () => {
  it('joins measures, type and the first two details', () => {
    expect(salesLineSpecText(spec())).toBe('25 × 52 × 15 mm · Rodamientos · Rígidos de bolas · Sello: 2RS · Material: Acero');
  });

  it('shows more details when asked, never fewer than zero', () => {
    expect(salesLineSpecText(spec(), { detailsShown: 3 })).toContain('Jaula: Metal');
    expect(salesLineSpecText(spec(), { detailsShown: 0 })).toBe('25 × 52 × 15 mm · Rodamientos · Rígidos de bolas');
    expect(salesLineSpecText(spec(), { detailsShown: -2 })).toBe('25 × 52 × 15 mm · Rodamientos · Rígidos de bolas');
  });

  it('skips what the product does not have', () => {
    expect(salesLineSpecText(spec({ measures: null }))).toBe('Rodamientos · Rígidos de bolas · Sello: 2RS · Material: Acero');
    expect(salesLineSpecText(spec({ subcategory: null, details: [] }))).toBe('25 × 52 × 15 mm · Rodamientos');
    expect(salesLineSpecText(spec({ measures: null, category: null, subcategory: null, details: [] }))).toBe('');
    expect(salesLineSpecText(null)).toBe('');
  });
});
