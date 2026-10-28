import type { ProductListItem } from '@rodasoft/domain';
import {
  availabilityOf,
  canLinkReference,
  branchStockSubtotal,
  describeProduct,
  flagOf,
  formatMeasure,
  thumbIconOf,
  toReferenceSearchResult,
  toTableRow,
} from './product-list.mapper';

const item = (over: Partial<ProductListItem> = {}): ProductListItem => ({
  id: 'p1',
  sku: 'RL-000001',
  manufacturerCode: '6205-2RS',
  name: 'Rodamiento rígido',
  photoUrl: null,
  brand: { id: 'b1', name: 'SKF', logoUrl: null },
  country: { id: 'c1', code: 'SE', name: 'Suecia' },
  category: { id: 'k1', name: 'Rodamientos', icon: 'bearing' },
  subcategory: { id: 'k2', name: 'Rígidos de bolas' },
  dimensions: { innerDiameter: '25.000', outerDiameter: '52.000', width: '15.000' },
  specs: [],
  totalStock: 60,
  branchStock: 24,
  salePrice: '245.00',
  status: 'ACTIVE',
  hasMovements: false,
  ...over,
});

describe('product list mapper', () => {
  it('formats measures with a decimal comma and no trailing zeros', () => {
    expect(formatMeasure('25.000')).toBe('25');
    expect(formatMeasure('16.250')).toBe('16,25');
    expect(formatMeasure('40')).toBe('40');
  });

  it('describes the product with its labelled d×D×B, without repeating the type', () => {
    expect(describeProduct(item())).toBe('Medidas: 25×52×15 mm');
    expect(describeProduct(item({ dimensions: null }))).toBe('');
    expect(toTableRow(item({ dimensions: null })).description).toBe('–');
  });

  it('derives availability: inactive, out and available', () => {
    expect(availabilityOf(item({ status: 'INACTIVE' }))).toBe('inactive');
    expect(availabilityOf(item({ branchStock: 0 }))).toBe('out');
    expect(availabilityOf(item({ branchStock: 3 }))).toBe('available');
    expect(availabilityOf(item({ branchStock: null, totalStock: 0 }))).toBe('out');
    expect(availabilityOf(item({ branchStock: null, totalStock: 5 }))).toBe('available');
  });

  it('only maps countries that have a flag', () => {
    expect(flagOf('SE')).toBe('SE');
    expect(flagOf('ZZ')).toBeNull();
    expect(flagOf(undefined)).toBeNull();
  });

  it('uses the category glyph for the photo placeholder and falls back to the bearing', () => {
    expect(thumbIconOf('droplet')).toBe('droplet');
    expect(thumbIconOf('not-an-icon')).toBe('bearing');
    expect(toTableRow(item({ category: { id: 'k3', name: 'Lubricantes', icon: 'droplet' } })).thumbIcon).toBe('droplet');
  });

  it('builds the table row', () => {
    expect(toTableRow(item())).toMatchObject({
      id: 'p1',
      code: '6205-2RS',
      brandName: 'SKF',
      country: 'SE',
      price: '245.00',
      availability: 'available',
    });
  });

  it('sums the branch stock only when a branch is selected', () => {
    expect(branchStockSubtotal([item({ branchStock: 24 }), item({ branchStock: 3 })])).toBe(27);
    expect(branchStockSubtotal([item({ branchStock: null })])).toBeNull();
    expect(branchStockSubtotal([])).toBeNull();
  });
});

describe('describeProduct with technical fields', () => {
  it('adds the filled technical fields after the measures', () => {
    const withSpecs = item({ specs: [{ label: 'Protección / sello', value: '2RS' }, { label: 'Material', value: 'Acero' }] });
    expect(describeProduct(withSpecs)).toBe('Medidas: 25×52×15 mm · Protección / sello: 2RS · Material: Acero');
  });

  it('uses the technical fields when the product has no measures', () => {
    expect(describeProduct(item({ dimensions: null, subcategory: null, specs: [{ label: 'Material', value: 'Goma' }] }))).toBe('Material: Goma');
  });
});

describe('toTableRow name', () => {
  it('shows the category as the product name', () => {
    expect(toTableRow(item()).name).toBe('Rodamientos');
    expect(toTableRow(item({ subcategory: null })).name).toBe('Rodamientos');
  });

  it('shows the subcategory under the name, and nothing when there is none', () => {
    expect(toTableRow(item()).categoryPath).toBe('Rígidos de bolas');
    expect(toTableRow(item({ subcategory: null })).categoryPath).toBe('');
  });
});

describe('describeProduct with weight', () => {
  it('writes the weight after the measures', () => {
    const heavy = item({ dimensions: { innerDiameter: '25.000', outerDiameter: '52.000', width: '15.000', weight: '0.130' } });
    expect(describeProduct(heavy)).toBe('Medidas: 25×52×15 mm · Peso: 0,13 kg');
  });
});

describe('toReferenceSearchResult', () => {
  it('gives the product photo, the dimensions, the specifications and the industry with its flag', () => {
    const result = toReferenceSearchResult(
      item({ photoUrl: 'https://cdn/6205.jpg', specs: [{ label: 'Sello', value: '2RS' }, { label: 'Material', value: 'Acero' }] }),
    );
    expect(result).toEqual({
      productId: 'p1',
      code: '6205-2RS',
      brand: 'SKF',
      categoryId: 'k2',
      measures: { innerDiameter: '25.000', outerDiameter: '52.000', width: '15.000' },
      photoUrl: 'https://cdn/6205.jpg',
      icon: 'bearing',
      dimensions: '25×52×15 mm',
      specs: 'Sello: 2RS · Material: Acero',
      industry: { name: 'Suecia', flag: 'SE' },
    });
  });

  it('leaves out what the product does not have, and gives no flag for an industry without one', () => {
    const result = toReferenceSearchResult(item({ dimensions: null, specs: [], country: { id: 'c9', code: 'ZZ', name: 'Otro' } }));
    expect(result).toMatchObject({ photoUrl: null, dimensions: null, specs: null, industry: { name: 'Otro', flag: null } });
    expect(toReferenceSearchResult(item({ country: null })).industry).toBeNull();
  });
});

describe('canLinkReference', () => {
  const measures = { innerDiameter: '25', outerDiameter: '52', width: '15' };
  const ref = (over: Partial<Parameters<typeof canLinkReference>[0]> = {}) => ({ categoryId: 'k2', measures: { innerDiameter: '25.000', outerDiameter: '52.000', width: '15.000' }, ...over });

  it('links a product of the same type and measures, comparing decimals by value', () => {
    expect(canLinkReference(ref(), { categoryId: 'k2', measures })).toBe(true);
  });

  it('does not link other measures, another type, or a product with no measures', () => {
    expect(canLinkReference(ref({ measures: { ...measures, outerDiameter: '62' } }), { categoryId: 'k2', measures })).toBe(false);
    expect(canLinkReference(ref({ categoryId: 'k9' }), { categoryId: 'k2', measures })).toBe(false);
    expect(canLinkReference(ref({ measures: null }), { categoryId: 'k2', measures })).toBe(false);
  });

  it('does not link while the product being created has no category or measures yet', () => {
    expect(canLinkReference(ref(), { categoryId: null, measures })).toBe(false);
    expect(canLinkReference(ref(), { categoryId: 'k2', measures: null })).toBe(false);
  });
});
