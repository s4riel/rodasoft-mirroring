import type { AttributeDefinitionItem } from '@rodasoft/domain';
import {
  attributesPayload,
  attributeStep,
  draftInputOf,
  invalidStockFields,
  toWriteRequest,
  type WizardFormValues,
} from './product-wizard.model';

const values = (over: Partial<WizardFormValues> = {}): WizardFormValues => ({
  manufacturerCode: ' 6205-2RS ',
  name: '',
  sectors: [],
  brandId: 'b-skf',
  countryId: null,
  subcategoryId: 'k-2',
  innerDiameter: '25',
  outerDiameter: '52',
  width: '15',
  weight: '',
  salePrice: '245.00',
  cost: '120.00',
  unit: 'UN',
  branchId: 'br-1',
  initialStock: '24',
  minStock: '',
  maxStock: '',
  location: '',
  supplierName: '',
  tariffCode: '',
  entryDate: '',
  attributes: { seal: '2RS (goma, contacto)', dynamicLoad: '33.2', series: '' },
  ...over,
});

const definitions: AttributeDefinitionItem[] = [
  { key: 'series', label: 'Serie', type: 'TEXT', unit: null, options: null, required: false, step: 2, sortOrder: 0 },
  { key: 'seal', label: 'Protección', type: 'ENUM', unit: null, options: ['Abierto', '2RS (goma, contacto)'], required: false, step: 3, sortOrder: 1 },
  { key: 'dynamicLoad', label: 'Carga dinámica C', type: 'NUMBER', unit: 'kN', options: null, required: false, step: 3, sortOrder: 2 },
];

describe('product wizard model', () => {
  it('puts the step-2 fields on the dimensions step only for bearings', () => {
    expect(attributeStep(definitions[0], true)).toBe('dimensions');
    expect(attributeStep(definitions[0], false)).toBe('specifications');
    expect(attributeStep(definitions[1], true)).toBe('specifications');
  });

  it('keeps only the fields the category defines, types the numbers and sends an empty field as null', () => {
    expect(attributesPayload(definitions, { seal: '2Z (metálico)', dynamicLoad: '33,2', other: 'x' })).toEqual({
      seal: '2Z (metálico)',
      dynamicLoad: 33.2,
      series: null,
    });
  });

  it('maps blank inputs to null so the domain rules see them as missing', () => {
    const input = draftInputOf(values({ manufacturerCode: '   ', salePrice: '', innerDiameter: '' }), 'r-1', true);
    expect(input.manufacturerCode).toBeNull();
    expect(input.salePrice).toBeNull();
    expect(input.dimensions.innerDiameter).toBeNull();
    expect(input.categoryId).toBe('k-2');
  });

  it('sends the status, the stock and the cost only with the cost permission', () => {
    const withCost = toWriteRequest(values(), definitions, { status: 'ACTIVE', categoryId: 'r-1', withCost: true });
    expect(withCost).toMatchObject({
      status: 'ACTIVE',
      manufacturerCode: '6205-2RS',
      categoryId: 'k-2',
      salePrice: '245.00',
      cost: '120.00',
      initialStock: 24,
      branchId: 'br-1',
      attributes: { seal: '2RS (goma, contacto)', dynamicLoad: 33.2 },
    });
    expect(withCost.minStock).toBeUndefined();

    const withoutCost = toWriteRequest(values(), definitions, { status: 'DRAFT', categoryId: 'r-1', withCost: false });
    expect(withoutCost.status).toBe('DRAFT');
    expect(withoutCost.cost).toBeUndefined();
  });

  it('sends money and measures with a dot, even when typed with the Bolivian comma', () => {
    const body = toWriteRequest(values({ salePrice: '245,50', innerDiameter: '17,5' }), definitions, {
      status: 'ACTIVE',
      categoryId: 'r-1',
      withCost: false,
    });
    expect(body.salePrice).toBe('245.50');
    expect(body.innerDiameter).toBe('17.5');
  });

  it('flags stock texts that are not whole numbers instead of sending them as zero', () => {
    expect(invalidStockFields(values({ initialStock: '24 uds', minStock: '1,5', maxStock: '' }))).toEqual([
      'initialStock',
      'minStock',
    ]);
    expect(toWriteRequest(values({ initialStock: '24 uds' }), definitions, { status: 'ACTIVE', categoryId: 'r-1', withCost: false }).initialStock).toBeUndefined();
  });

  it('falls back to the root category when no subcategory is chosen', () => {
    const body = toWriteRequest(values({ subcategoryId: null }), definitions, { status: 'DRAFT', categoryId: 'r-1', withCost: false });
    expect(body.categoryId).toBe('r-1');
  });
});
