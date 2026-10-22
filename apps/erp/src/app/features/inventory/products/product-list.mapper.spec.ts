import type { ProductListItem } from '@rodasoft/domain';
import {
  availabilityOf,
  branchStockSubtotal,
  describeProduct,
  flagOf,
  formatMeasure,
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
  category: { id: 'k1', name: 'Rodamientos' },
  subcategory: { id: 'k2', name: 'Rígidos de bolas' },
  dimensions: { innerDiameter: '25.000', outerDiameter: '52.000', width: '15.000' },
  totalStock: 60,
  branchStock: 24,
  salePrice: '245.00',
  status: 'ACTIVE',
  ...over,
});

describe('product list mapper', () => {
  it('formats measures with a decimal comma and no trailing zeros', () => {
    expect(formatMeasure('25.000')).toBe('25');
    expect(formatMeasure('16.250')).toBe('16,25');
    expect(formatMeasure('40')).toBe('40');
  });

  it('describes the product with its subcategory and d×D×B', () => {
    expect(describeProduct(item())).toBe('Rígidos de bolas, 25×52×15 mm');
    expect(describeProduct(item({ subcategory: null }))).toBe('Rodamientos, 25×52×15 mm');
    expect(describeProduct(item({ dimensions: null }))).toBe('Rígidos de bolas');
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
