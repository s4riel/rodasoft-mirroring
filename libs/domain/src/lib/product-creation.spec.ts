import { type AttributeRule, completedRequiredSteps, type ProductDraftInput, validateProductDraft, wizardSteps } from './product-creation';

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
