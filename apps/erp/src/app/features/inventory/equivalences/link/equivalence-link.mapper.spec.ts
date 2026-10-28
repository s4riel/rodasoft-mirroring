import type { ProductDetail, ProductListItem } from '@rodasoft/domain';
import {
  existsMessage,
  isAvailableEquivalent,
  incompatibleMessage,
  linkProductOfDetail,
  linkProductOfListItem,
  type LinkProduct,
  measuresText,
  productLabel,
  shownType,
  TYPE_OPTIONS,
} from './equivalence-link.mapper';

const product = (over: Partial<LinkProduct> = {}): LinkProduct => ({
  id: 'p1',
  manufacturerCode: '6205-2RS',
  brand: { id: 'b', name: 'SKF', logoUrl: null },
  country: null,
  photoUrl: null,
  categoryIcon: 'bearing',
  dimensions: { innerDiameter: '25.000', outerDiameter: '52.000', width: '15.000' },
  ...over,
});

describe('equivalence link mapper', () => {
  it('reads a list item as a link product, keeping the measures and the root category glyph', () => {
    const item = {
      id: 'p1',
      manufacturerCode: '6205-2RS',
      brand: { id: 'b', name: 'SKF', logoUrl: null },
      country: { id: 'c', code: 'SE', name: 'Suecia' },
      photoUrl: 'a.jpg',
      category: { id: 'k', name: 'Rodamientos', icon: 'bearing' },
      dimensions: { innerDiameter: '25', outerDiameter: '52', width: '15', weight: '0.13' },
    } as ProductListItem;
    expect(linkProductOfListItem(item)).toEqual({
      id: 'p1',
      manufacturerCode: '6205-2RS',
      brand: item.brand,
      country: item.country,
      photoUrl: 'a.jpg',
      categoryIcon: 'bearing',
      dimensions: { innerDiameter: '25', outerDiameter: '52', width: '15' },
    });
    expect(linkProductOfListItem({ ...item, dimensions: null }).dimensions).toBeNull();
  });

  it('reads a product detail as a link product, with its first photo', () => {
    const detail = {
      id: 'p1',
      manufacturerCode: '6205-2RS',
      brand: { id: 'b', name: 'SKF', logoUrl: null },
      country: null,
      photos: ['one.jpg', 'two.jpg'],
      category: { id: 'k', name: 'Rodamientos', icon: 'bearing' },
      dimensions: { innerDiameter: '25', outerDiameter: '52', width: '15', weight: null },
    } as unknown as ProductDetail;
    expect(linkProductOfDetail(detail)).toMatchObject({ photoUrl: 'one.jpg', dimensions: { innerDiameter: '25', outerDiameter: '52', width: '15' } });
    expect(linkProductOfDetail({ ...detail, photos: [], dimensions: null })).toMatchObject({ photoUrl: null, dimensions: null });
  });

  it('writes the measures as d×D×B in mm, with a comma and no trailing zeros, or an en dash when one is missing', () => {
    expect(measuresText({ innerDiameter: '25.000', outerDiameter: '52.000', width: '15.250' })).toBe('25×52×15,25 mm');
    expect(measuresText({ innerDiameter: '25', outerDiameter: '52', width: null })).toBe('–');
    expect(measuresText(null)).toBe('–');
  });

  it('labels a product as the field of the design does: code, a dot and the brand', () => {
    expect(productLabel(product())).toBe('6205-2RS · SKF');
  });

  it('offers the three types of the design, in its order', () => {
    expect(TYPE_OPTIONS.map((o) => [o.value, o.label])).toEqual([
      ['EXACT', 'Exacta'],
      ['WITH_DIFFERENCES', 'Con diferencias'],
      ['SUBSTITUTE', 'Sustituto'],
    ]);
  });

  it('shows the computed type, or "Sustituto" when the user chose it, and nothing for an incompatible or unknown pair', () => {
    expect(shownType(false, 'EXACT')).toBe('EXACT');
    expect(shownType(false, 'WITH_DIFFERENCES')).toBe('WITH_DIFFERENCES');
    expect(shownType(true, 'EXACT')).toBe('SUBSTITUTE');
    expect(shownType(false, 'INCOMPATIBLE')).toBeNull();
    expect(shownType(false, null)).toBeNull();
  });

  it('words the duplicate error as IN-15d does', () => {
    expect(existsMessage(product(), product({ id: 'p2', manufacturerCode: '6205-DDU' }))).toBe(
      'Ya existe el vínculo 6205-2RS → 6205-DDU. Edítalo desde la lista.',
    );
  });

  it('words the incompatible measures as IN-15e does, with both products measures', () => {
    const other = product({ id: 'p2', dimensions: { innerDiameter: '25', outerDiameter: '62', width: '17' } });
    const validation = { measureDifferences: [{ key: 'D' as const, a: '52', b: '62' }] };
    expect(incompatibleMessage(product(), other, validation)).toBe('Medidas: 25×52×15 mm (origen) frente a 25×62×17 mm (equivalente).');
  });

  it('says it is another type when the measures are the same', () => {
    expect(incompatibleMessage(product(), product({ id: 'p2' }), { measureDifferences: [] })).toBe('No son del mismo tipo de rodamiento.');
  });
});

describe('isAvailableEquivalent', () => {
  const origin = product();
  const other = (over: Partial<LinkProduct> = {}) => product({ id: 'p2', ...over });
  const none = new Set<string>();

  it('offers any other product that is not linked to the origin yet', () => {
    expect(isAvailableEquivalent(other(), origin, none)).toBe(true);
  });

  it('does not offer the origin itself or a product it is already linked to', () => {
    expect(isAvailableEquivalent(origin, origin, none)).toBe(false);
    expect(isAvailableEquivalent(other(), origin, new Set(['p2']))).toBe(false);
  });
});
