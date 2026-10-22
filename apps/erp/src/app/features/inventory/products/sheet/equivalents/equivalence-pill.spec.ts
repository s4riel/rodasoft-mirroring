import type { ProductEquivalentItem } from '@rodasoft/domain';
import { describeDifference, equivalencePill, ORIGINAL_PILL } from './equivalence-pill';

const item = (over: Partial<ProductEquivalentItem>): ProductEquivalentItem => ({
  productId: 'p',
  manufacturerCode: '6205-DDU',
  brand: { id: 'b', name: 'NSK', logoUrl: null },
  country: null,
  totalStock: 0,
  salePrice: '1.00',
  status: 'ACTIVE',
  kind: 'EXACT',
  differences: [],
  ...over,
});

const SEAL = { key: 'seal', label: 'Protección / sello', source: '2RS', other: 'DDU' };
const CAGE = { key: 'cage', label: 'Material de la jaula', source: 'Acero', other: null };


describe('equivalencePill', () => {
  it('says "Exacta" with a check for an exact equivalent', () => {
    expect(equivalencePill(item({ kind: 'EXACT' }))).toEqual({ label: 'Exacta', status: 'success', icon: 'check' });
  });

  it('names the first difference and counts the rest, with all of them in the tooltip', () => {
    const pill = equivalencePill(item({ kind: 'WITH_DIFFERENCES', differences: [SEAL, CAGE] }));
    expect(pill).toMatchObject({ label: 'Protección / sello +1', status: 'warning', icon: 'alert' });
    expect(pill.tooltip).toBe('Protección / sello: 2RS → DDU · Material de la jaula: Acero → —');
  });

  it('names a single difference without a counter', () => {
    expect(equivalencePill(item({ kind: 'WITH_DIFFERENCES', differences: [SEAL] })).label).toBe('Protección / sello');
  });

  it('uses the short wording for the sheet card', () => {
    const pill = equivalencePill(item({ kind: 'WITH_DIFFERENCES', differences: [SEAL] }), 'short');
    expect(pill.label).toBe('Con diferencias');
    expect(pill.tooltip).toContain('2RS → DDU');
  });

  it('flags different measures as danger', () => {
    expect(equivalencePill(item({ kind: 'INCOMPATIBLE' }))).toMatchObject({ label: 'Medidas distintas', status: 'danger' });
  });

  it('draws the original as a neutral pill with a glyph', () => {
    expect(ORIGINAL_PILL).toEqual({ label: 'Original', status: 'idle', icon: 'alert' });
  });

  it('writes a difference with an em dash for a missing value', () => {
    expect(describeDifference(CAGE)).toBe('Material de la jaula: Acero → —');
  });
});
