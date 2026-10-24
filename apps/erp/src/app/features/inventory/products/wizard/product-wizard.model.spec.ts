import type { AttributeDefinitionItem } from '@rodasoft/domain';
import {
  attributesPayload,
  attributeStep,
  commercialNameOf,
  draftInputOf,
  formatSize,
  invalidStockFields,
  isLongText,
  placeholderOf,
  toUpdateRequest,
  toWriteRequest,
  uploadDetailOf,
  uploadProblemOf,
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

  it('writes sizes with a comma and estimates the time left of an upload', () => {
    expect(formatSize(3.5 * 1024 * 1024)).toBe('3,5 MB');
    expect(formatSize(820 * 1024)).toBe('820 KB');
    expect(uploadDetailOf(1024 * 1024, 2, 2000)).toBe('1,0 MB');
    expect(uploadDetailOf(1024 * 1024, 40, 4000)).toBe('1,0 MB · 6 s restantes');
    expect(uploadDetailOf(1024 * 1024, 100, 9000)).toBe('1,0 MB · Procesando…');
  });

  it('refuses a file of the wrong type or over the limit for its kind', () => {
    const mb = 1024 * 1024;
    expect(uploadProblemOf('photo', { name: 'a.jpg', type: 'image/jpeg', size: mb })).toBeNull();
    expect(uploadProblemOf('photo', { name: 'a.pdf', type: 'application/pdf', size: mb })).toContain('imagen');
    expect(uploadProblemOf('photo', { name: 'big.png', type: 'image/png', size: 6 * mb })).toContain('5 MB');
    expect(uploadProblemOf('datasheet', { name: 'f.pdf', type: 'application/pdf', size: 9 * mb })).toBeNull();
    expect(uploadProblemOf('datasheet', { name: 'f.jpg', type: 'image/jpeg', size: mb })).toContain('PDF');
  });

  it('suggests the commercial name from category, brand and code, skipping what is missing', () => {
    expect(commercialNameOf('Rodamientos rígidos', 'SKF', ' 6205-2RS ')).toBe('Rodamientos rígidos SKF 6205-2RS');
    expect(commercialNameOf('Rodamientos', null, '')).toBe('Rodamientos');
  });

  it('falls back to the root category when no subcategory is chosen', () => {
    const body = toWriteRequest(values({ subcategoryId: null }), definitions, { status: 'DRAFT', categoryId: 'r-1', withCost: false });
    expect(body.categoryId).toBe('r-1');
  });
});

describe('long text and placeholders', () => {
  const def = (over: Partial<AttributeDefinitionItem>): AttributeDefinitionItem => ({
    key: 'material',
    label: 'Material',
    type: 'TEXT',
    unit: null,
    options: null,
    required: false,
    step: 3,
    sortOrder: 0,
    ...over,
  });

  it('treats the technical notes as long text, and nothing else', () => {
    expect(isLongText(def({ key: 'technicalNotes', label: 'Observaciones técnicas' }))).toBe(true);
    expect(isLongText(def({}))).toBe(false);
    expect(isLongText(def({ key: 'rows', label: 'Número de hileras', type: 'NUMBER' }))).toBe(false);
  });

  it('gives every technical field a placeholder from its type', () => {
    expect(placeholderOf(def({}))).toBe('Ingresa material');
    expect(placeholderOf(def({ type: 'NUMBER', unit: 'kN', label: 'Carga' }))).toBe('0,00 kN');
    expect(placeholderOf(def({ type: 'NUMBER' }))).toBe('0');
    expect(placeholderOf(def({ type: 'ENUM' }))).toBe('Selecciona una opción');
    expect(placeholderOf(def({ key: 'technicalNotes', label: 'Observaciones técnicas' }))).toBe('Escribe observaciones técnicas del producto');
  });

  describe('toUpdateRequest', () => {
    const update = (over: Partial<WizardFormValues> = {}, thresholdBranchId: string | null = null) =>
      toUpdateRequest(values(over), definitions, {
        categoryId: 'r-1',
        withCost: true,
        expectedUpdatedAt: '2026-10-23T15:00:00.000Z',
        thresholdBranchId,
      });

    it('carries the lock value and the whole form, and never the stock, the receiving branch or the status', () => {
      const body = update();

      expect(body).toMatchObject({ expectedUpdatedAt: '2026-10-23T15:00:00.000Z', manufacturerCode: '6205-2RS', brandId: 'b-skf', categoryId: 'k-2', salePrice: '245.00', cost: '120.00' });
      for (const field of ['status', 'branchId', 'initialStock', 'minStock', 'maxStock', 'location', 'thresholdBranchId']) {
        expect(body).not.toHaveProperty(field);
      }
    });

    it('sends the thresholds with their branch when asked, and an emptied one as null so it is cleared', () => {
      const body = update({ minStock: '5', maxStock: '', location: ' B-2 ' }, 'br-1');

      expect(body).toMatchObject({ thresholdBranchId: 'br-1', minStock: 5, maxStock: null, location: 'B-2' });
      expect(update({ location: '' }, 'br-1').location).toBeNull();
    });

    it('leaves the cost out for who cannot see costs', () => {
      const body = toUpdateRequest(values(), definitions, { categoryId: 'r-1', withCost: false, expectedUpdatedAt: 'x', thresholdBranchId: null });

      expect(body).not.toHaveProperty('cost');
    });
  });
});
