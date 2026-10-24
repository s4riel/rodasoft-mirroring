import {
  type AttributeRule,
  completedRequiredSteps,
  diffProduct,
  editableFields,
  type ProductDraftInput,
  type ProductSnapshot,
  todayInLaPaz,
  validateFieldFormats,
  validateProductDraft,
  wizardSteps,
} from './product-creation';

const bearing: ProductDraftInput = {
  manufacturerCode: '6205-2RS',
  brandId: 'brand-1',
  categoryId: 'cat-1',
  isBearing: true,
  salePrice: '45.50',
  dimensions: { innerDiameter: '25', outerDiameter: '52', width: '15' },
  attributes: {},
};
const rules: AttributeRule[] = [
  { key: 'seal', type: 'ENUM', required: true, options: ['Abierto', '2RS (goma, contacto)'] },
  { key: 'dynamicLoad', type: 'NUMBER', required: false, options: null },
  { key: 'sealed', type: 'BOOLEAN', required: false, options: null },
];
const complete: ProductDraftInput = { ...bearing, attributes: { seal: 'Abierto' } };

describe('wizardSteps', () => {
  it('gives bearings 6 steps and the other categories 4', () => {
    expect(wizardSteps(true).map((s) => s.key)).toEqual([
      'identification',
      'dimensions',
      'specifications',
      'price-inventory',
      'photos',
      'equivalences',
    ]);
    expect(wizardSteps(false).map((s) => s.key)).toEqual(['identification', 'specifications', 'price-inventory', 'photos']);
  });

  it('marks identification, price and inventory (and dimensions for bearings) as required', () => {
    expect(wizardSteps(true).filter((s) => s.required).map((s) => s.key)).toEqual(['identification', 'dimensions', 'price-inventory']);
    expect(wizardSteps(false).filter((s) => s.required).map((s) => s.key)).toEqual(['identification', 'specifications', 'price-inventory']);
  });
});

describe('completedRequiredSteps', () => {
  it('counts only the required steps', () => {
    const steps = wizardSteps(true);
    expect(completedRequiredSteps(steps, new Set(['identification', 'specifications']))).toEqual({ done: 1, total: 3 });
    expect(completedRequiredSteps(steps, new Set(['identification', 'dimensions', 'price-inventory']))).toEqual({ done: 3, total: 3 });
  });
});

describe('validateProductDraft', () => {
  it('accepts a complete bearing', () => {
    expect(validateProductDraft(complete, rules, { draft: false })).toEqual([]);
  });

  it('reports PRICE_REQUIRED for a final product without a price, but not for a draft', () => {
    const noPrice = { ...complete, salePrice: null };
    expect(validateProductDraft(noPrice, rules, { draft: false })).toContainEqual({ field: 'salePrice', code: 'PRICE_REQUIRED' });
    expect(validateProductDraft(noPrice, rules, { draft: true })).toEqual([]);
  });

  it('treats a zero price as missing', () => {
    expect(validateProductDraft({ ...complete, salePrice: '0' }, rules, { draft: false })).toContainEqual({
      field: 'salePrice',
      code: 'PRICE_REQUIRED',
    });
  });

  it('only requires the code and the brand for a draft', () => {
    const minimal: ProductDraftInput = {
      ...bearing,
      categoryId: null,
      salePrice: null,
      dimensions: { innerDiameter: null, outerDiameter: null, width: null },
      attributes: {},
    };
    expect(validateProductDraft(minimal, rules, { draft: true })).toEqual([]);
    expect(validateProductDraft({ ...minimal, manufacturerCode: '  ', brandId: null }, rules, { draft: true })).toEqual([
      { field: 'manufacturerCode', code: 'CODE_REQUIRED' },
      { field: 'brandId', code: 'BRAND_REQUIRED' },
    ]);
  });

  it('requires d, D and B for bearings', () => {
    const noWidth = { ...complete, dimensions: { ...bearing.dimensions, width: '' } };
    expect(validateProductDraft(noWidth, rules, { draft: false })).toContainEqual({ field: 'dimensions', code: 'DIMENSIONS_REQUIRED' });
  });

  it('does not ask for dimensions for other categories', () => {
    const other = { ...complete, isBearing: false, dimensions: { innerDiameter: null, outerDiameter: null, width: null } };
    expect(validateProductDraft(other, rules, { draft: false })).toEqual([]);
  });

  it('requires the category for a final product', () => {
    expect(validateProductDraft({ ...complete, categoryId: null }, rules, { draft: false })).toContainEqual({
      field: 'categoryId',
      code: 'CATEGORY_REQUIRED',
    });
  });

  it('requires the technical fields of a final product only', () => {
    const empty = { ...bearing, attributes: {} };
    expect(validateProductDraft(empty, rules, { draft: false })).toContainEqual({ field: 'seal', code: 'ATTRIBUTE_REQUIRED' });
    expect(validateProductDraft(empty, rules, { draft: true })).toEqual([]);
  });

  it('checks the type of the values that are present', () => {
    const wrong = { ...complete, attributes: { seal: 'Abierto', dynamicLoad: 'mucho', sealed: 'sí' } };
    expect(validateProductDraft(wrong, rules, { draft: false })).toEqual([
      { field: 'dynamicLoad', code: 'ATTRIBUTE_TYPE' },
      { field: 'sealed', code: 'ATTRIBUTE_TYPE' },
    ]);
  });

  it('rejects an attribute the category does not define', () => {
    expect(validateProductDraft({ ...complete, attributes: { seal: 'Abierto', color: 'rojo' } }, rules, { draft: false })).toEqual([
      { field: 'color', code: 'ATTRIBUTE_UNKNOWN' },
    ]);
  });

  it('checks the enum option', () => {
    expect(validateProductDraft({ ...complete, attributes: { seal: 'Metal' } }, rules, { draft: false })).toEqual([
      { field: 'seal', code: 'ATTRIBUTE_OPTION' },
    ]);
  });
});

describe('validateFieldFormats', () => {
  const codes = (over: Partial<ProductDraftInput>) => validateFieldFormats({ ...complete, ...over }).map((e) => `${e.field}:${e.code}`);

  it('accepts amounts and measures with a comma or a dot', () => {
    expect(codes({ salePrice: '245,50', cost: '30,1234', weight: '0,13' })).toEqual([]);
    expect(codes({ salePrice: '245.5', dimensions: { innerDiameter: '25,5', outerDiameter: '52', width: '15' } })).toEqual([]);
  });

  it('refuses a price that is not money: letters, a thousands separator, more than 2 decimals, a sign', () => {
    for (const salePrice of ['abc', '1.250,50', '12,345', '-5', '1e3', '12,']) {
      expect(codes({ salePrice })).toEqual(['salePrice:PRICE_FORMAT']);
    }
  });

  it('allows up to 4 decimals on the cost, no more', () => {
    expect(codes({ cost: '30,1234' })).toEqual([]);
    expect(codes({ cost: '30,12345' })).toEqual(['cost:COST_FORMAT']);
  });

  it('refuses measures that are not positive numbers with at most 3 decimals', () => {
    expect(codes({ dimensions: { innerDiameter: '0', outerDiameter: '52', width: 'x' } })).toEqual([
      'innerDiameter:MEASURE_FORMAT',
      'width:MEASURE_FORMAT',
    ]);
    expect(codes({ weight: '1,2345' })).toEqual(['weight:MEASURE_FORMAT']);
  });

  it('wants the bore smaller than the outside diameter', () => {
    expect(codes({ dimensions: { innerDiameter: '52', outerDiameter: '25', width: '15' } })).toEqual(['outerDiameter:DIAMETER_ORDER']);
    expect(codes({ dimensions: { innerDiameter: '25', outerDiameter: '25', width: '15' } })).toEqual(['outerDiameter:DIAMETER_ORDER']);
  });

  it('checks the tariff heading and the entry date', () => {
    expect(codes({ tariffCode: '8482.10', entryDate: '2026-10-22', today: '2026-10-23' })).toEqual([]);
    expect(codes({ tariffCode: '84-82' })).toEqual(['tariffCode:TARIFF_FORMAT']);
    expect(codes({ entryDate: '2026-02-30' })).toEqual(['entryDate:DATE_INVALID']);
    expect(codes({ entryDate: '2026-12-01', today: '2026-10-23' })).toEqual(['entryDate:DATE_FUTURE']);
  });

  it('wants the maximum stock to be at least the minimum', () => {
    expect(codes({ minStock: 10, maxStock: 5 })).toEqual(['maxStock:STOCK_RANGE']);
    expect(codes({ minStock: 5, maxStock: 5 })).toEqual([]);
  });

  it('is applied to drafts too, and a bad price is not also reported as missing', () => {
    expect(validateProductDraft({ ...complete, salePrice: 'abc' }, rules, { draft: true })).toEqual([{ field: 'salePrice', code: 'PRICE_FORMAT' }]);
    expect(validateProductDraft({ ...complete, salePrice: 'abc' }, rules, { draft: false })).toEqual([{ field: 'salePrice', code: 'PRICE_FORMAT' }]);
  });

  it('gives today in La Paz, a day behind UTC late in the evening', () => {
    expect(todayInLaPaz(new Date('2026-10-23T02:00:00Z'))).toBe('2026-10-22');
    expect(todayInLaPaz(new Date('2026-10-23T14:00:00Z'))).toBe('2026-10-23');
  });
});

const stored: ProductSnapshot = {
  manufacturerCode: '6205-2RS',
  name: 'Rodamientos SKF 6205-2RS',
  brandId: 'brand-1',
  categoryId: 'cat-1',
  countryId: 'country-1',
  unit: 'UN',
  salePrice: '45.50',
  cost: '30.0000',
  innerDiameter: '25.000',
  outerDiameter: '52.000',
  width: '15.000',
  weight: null,
  attributes: { seal: 'Abierto', dynamicLoad: 14.8 },
  sectors: ['Minería'],
  tariffCode: null,
  supplierName: null,
  entryDate: null,
  photos: [],
  datasheetKey: null,
};

describe('diffProduct', () => {
  it('is empty when nothing changed, even if decimals are written differently', () => {
    const after: ProductSnapshot = { ...stored, salePrice: '45.5', innerDiameter: '25', cost: '30', attributes: { seal: 'Abierto', dynamicLoad: '14.80' }, tariffCode: '' };
    expect(diffProduct(stored, after)).toEqual({ before: {}, after: {} });
  });

  it('reports only the changed fields, with both sides', () => {
    const after: ProductSnapshot = { ...stored, salePrice: '49.90', width: '16', sectors: ['Minería', 'Industria'] };
    expect(diffProduct(stored, after)).toEqual({
      before: { salePrice: '45.50', width: '15.000', sectors: ['Minería'] },
      after: { salePrice: '49.90', width: '16', sectors: ['Minería', 'Industria'] },
    });
  });

  it('flattens the technical fields as attributes.<key>, including added and removed ones', () => {
    const after: ProductSnapshot = { ...stored, attributes: { seal: '2RS', rows: 2 } };
    expect(diffProduct(stored, after)).toEqual({
      before: { 'attributes.seal': 'Abierto', 'attributes.dynamicLoad': 14.8, 'attributes.rows': null },
      after: { 'attributes.seal': '2RS', 'attributes.dynamicLoad': null, 'attributes.rows': 2 },
    });
  });

  it('treats a cleared field as a change to null', () => {
    expect(diffProduct(stored, { ...stored, cost: null, countryId: null })).toEqual({
      before: { cost: '30.0000', countryId: 'country-1' },
      after: { cost: null, countryId: null },
    });
  });
});

describe('editableFields', () => {
  it('never lets stock, the receiving branch or the status change', () => {
    for (const hasMovements of [false, true]) {
      for (const canViewCost of [false, true]) {
        const fields = editableFields({ hasMovements, canViewCost });
        expect([fields.initialStock, fields.branchId, fields.status]).toEqual([false, false, false]);
      }
    }
  });

  it('allows brand and category while the product has no movements', () => {
    const fields = editableFields({ hasMovements: false, canViewCost: true });
    expect([fields.brandId, fields.categoryId, fields.cost, fields.salePrice]).toEqual([true, true, true, true]);
  });

  it('locks brand and category once the product has movements', () => {
    const fields = editableFields({ hasMovements: true, canViewCost: true });
    expect([fields.brandId, fields.categoryId]).toEqual([false, false]);
    expect([fields.manufacturerCode, fields.salePrice, fields.minStock]).toEqual([true, true, true]);
  });

  it('only lets who can see costs change them', () => {
    expect(editableFields({ hasMovements: false, canViewCost: false }).cost).toBe(false);
  });
});
