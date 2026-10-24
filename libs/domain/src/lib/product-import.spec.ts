import type { AttributeRule } from './product-creation';
import {
  describeImportIssue,
  emptyImportRow,
  type ImportExistingProduct,
  type ImportLookups,
  type ImportRow,
  mapImportHeaders,
  normalizeImportText,
  parseStockQuantity,
  planStockChanges,
  summarizeImport,
  validateImportRow,
  validateImportRows,
} from './product-import';

const rules: AttributeRule[] = [
  { key: 'seal', type: 'ENUM', required: true, options: ['Abierto', '2RS'] },
  { key: 'sealed', type: 'BOOLEAN', required: false, options: null },
];

function lookups(over: Partial<ImportLookups> = {}, existing: ImportExistingProduct | null = null): ImportLookups {
  return {
    brandId: (name) => (normalizeImportText(name) === 'skf' ? 'brand-skf' : null),
    category: (category, subcategory) => {
      if (normalizeImportText(category) !== 'rodamientos') return 'CATEGORY_NOT_FOUND';
      if (subcategory.trim() && normalizeImportText(subcategory) !== 'rigidos') return 'SUBCATEGORY_NOT_FOUND';
      return { id: 'cat-bearing', rules, isBearing: true };
    },
    warehouse: (code) => {
      if (code === 'HK-01') return { id: 'w1', code: 'HK-01', active: true, allowed: true };
      if (code === 'OLD') return { id: 'w2', code: 'OLD', active: false, allowed: true };
      if (code === 'LP-01') return { id: 'w3', code: 'LP-01', active: true, allowed: false };
      return null;
    },
    existing: () => existing,
    ...over,
  };
}

function row(over: Partial<ImportRow> = {}): ImportRow {
  return {
    ...emptyImportRow(2),
    code: '6205-2RS',
    brand: 'SKF',
    category: 'Rodamientos',
    price: '45,50',
    innerDiameter: '25',
    outerDiameter: '52',
    width: '15',
    attributes: { seal: '2RS' },
    ...over,
  };
}

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe('mapImportHeaders', () => {
  it('maps the template headers ignoring case and accents, but keeps d and D apart', () => {
    const map = mapImportHeaders(['codigo', 'MARCA', 'Categoría', 'd', 'D', 'B', 'Stock hk-01', 'seal', 'Notas'], ['seal']);
    expect(map.columns.map((c) => (c.kind === 'fixed' ? c.field : c.kind === 'stock' ? c.warehouseCode : c.kind === 'attribute' ? c.key : c.header))).toEqual([
      'code',
      'brand',
      'category',
      'innerDiameter',
      'outerDiameter',
      'width',
      'HK-01',
      'seal',
      'Notas',
    ]);
    expect(map.missing).toEqual([]);
    expect(map.unknown).toEqual(['Notas']);
  });

  it('reports the required headers the sheet lacks', () => {
    expect(mapImportHeaders(['Código', 'Precio'], []).missing).toEqual(['Marca', 'Categoría']);
  });
});

describe('validateImportRow', () => {
  it('accepts a complete row and resolves its references', () => {
    const result = validateImportRow(row(), lookups(), 'create_only');
    expect(result).toMatchObject({ status: 'valid', action: 'create', brandId: 'brand-skf', categoryId: 'cat-bearing', productId: null });
    expect(result.errors).toEqual([]);
  });

  it('refuses an unknown brand without also calling it required (decision #33)', () => {
    const result = validateImportRow(row({ brand: 'Nueva' }), lookups(), 'create_only');
    expect(codes(result.errors)).toEqual(['BRAND_NOT_FOUND']);
    expect(result.status).toBe('error');
  });

  it('matches the brand without caring for case or accents', () => {
    expect(validateImportRow(row({ brand: ' skf ' }), lookups(), 'create_only').status).toBe('valid');
  });

  it('refuses an unknown category and subcategory', () => {
    expect(codes(validateImportRow(row({ category: 'Motores' }), lookups(), 'create_only').errors)).toEqual(['CATEGORY_NOT_FOUND']);
    expect(codes(validateImportRow(row({ subcategory: 'Agujas' }), lookups(), 'create_only').errors)).toEqual(['SUBCATEGORY_NOT_FOUND']);
  });

  it('asks for the fields that are missing (decision #32 rules of the wizard)', () => {
    const result = validateImportRow(row({ code: '', brand: '', category: '', price: '', innerDiameter: '', attributes: {} }), lookups(), 'create_only');
    expect(codes(result.errors)).toEqual(expect.arrayContaining(['CODE_REQUIRED', 'BRAND_REQUIRED', 'CATEGORY_REQUIRED', 'PRICE_REQUIRED']));
  });

  it('asks for the dimensions of a bearing and the required technical fields', () => {
    const result = validateImportRow(row({ innerDiameter: '', attributes: {} }), lookups(), 'create_only');
    expect(codes(result.errors)).toEqual(expect.arrayContaining(['DIMENSIONS_REQUIRED', 'ATTRIBUTE_REQUIRED']));
  });

  it('refuses an invalid price and a technical field the category does not have', () => {
    const result = validateImportRow(row({ price: '4x', attributes: { seal: '2RS', color: 'rojo' } }), lookups(), 'create_only');
    expect(codes(result.errors)).toEqual(expect.arrayContaining(['PRICE_FORMAT', 'ATTRIBUTE_UNKNOWN']));
  });

  it('converts a technical boolean written as text', () => {
    expect(validateImportRow(row({ attributes: { seal: '2RS', sealed: 'Sí' } }), lookups(), 'create_only').status).toBe('valid');
    expect(codes(validateImportRow(row({ attributes: { seal: '2RS', sealed: 'quizás' } }), lookups(), 'create_only').errors)).toEqual(['ATTRIBUTE_TYPE']);
  });

  describe('an existing product', () => {
    const existing: ImportExistingProduct = { id: 'p1', status: 'ACTIVE', categoryId: 'cat-bearing', hasMovements: true, stock: new Map([['w1', 10]]) };

    it('is an error in create-only mode', () => {
      const result = validateImportRow(row(), lookups({}, existing), 'create_only');
      expect(result).toMatchObject({ status: 'error', action: 'skip', productId: 'p1' });
      expect(codes(result.errors)).toEqual(['PRODUCT_EXISTS']);
    });

    it('is a warning in create-or-update mode', () => {
      const result = validateImportRow(row(), lookups({}, existing), 'create_or_update');
      expect(result).toMatchObject({ status: 'valid', action: 'update', productId: 'p1' });
      expect(codes(result.warnings)).toEqual(['PRODUCT_WILL_UPDATE']);
    });

    it("keeps stored values for blank price, dimensions and required fields when the category is the same", () => {
      const bare = row({ price: '', innerDiameter: '', attributes: {} });
      const result = validateImportRow(bare, lookups({}, existing), 'create_or_update');
      expect(result.status).toBe('valid');
      expect(codes(result.errors)).toEqual([]);
    });

    it('cannot change the category once it has movements', () => {
      const result = validateImportRow(row(), lookups({}, { ...existing, categoryId: 'cat-other' }), 'create_or_update');
      expect(codes(result.errors)).toEqual(['CATEGORY_LOCKED']);
    });

    it('cannot update a draft', () => {
      const result = validateImportRow(row(), lookups({}, { ...existing, status: 'DRAFT' }), 'create_or_update');
      expect(codes(result.errors)).toEqual(['EXISTING_IS_DRAFT']);
    });

    it('warns when the stock will be adjusted', () => {
      const result = validateImportRow(row({ stock: { 'HK-01': '25' } }), lookups({}, existing), 'create_or_update');
      expect(result.warnings).toContainEqual({ field: 'Stock HK-01', code: 'STOCK_WILL_ADJUST', params: { warehouse: 'HK-01', from: 10, to: 25 } });
      expect(result.stockTargets).toEqual([{ warehouseId: 'w1', warehouseCode: 'HK-01', quantity: 25 }]);
    });

    it('does not warn when the quantity is the same', () => {
      const result = validateImportRow(row({ stock: { 'HK-01': '10' } }), lookups({}, existing), 'create_or_update');
      expect(codes(result.warnings)).toEqual(['PRODUCT_WILL_UPDATE']);
    });

    it('rejects stock on a row that is skipped', () => {
      const result = validateImportRow(row({ stock: { 'HK-01': '5' } }), lookups({}, existing), 'create_only');
      expect(codes(result.errors)).toEqual(['PRODUCT_EXISTS', 'STOCK_ON_SKIPPED_ROW']);
      expect(result.stockTargets).toEqual([]);
    });
  });

  describe('stock columns', () => {
    it('collects the wanted quantity per warehouse and ignores blanks', () => {
      const result = validateImportRow(row({ stock: { 'HK-01': '12', 'LP-01': ' ' } }), lookups(), 'create_only');
      expect(result.status).toBe('valid');
      expect(result.stockTargets).toEqual([{ warehouseId: 'w1', warehouseCode: 'HK-01', quantity: 12 }]);
    });

    it('refuses an unknown, inactive or not operable warehouse', () => {
      const result = validateImportRow(row({ stock: { XX: '1', OLD: '1', 'LP-01': '1' } }), lookups(), 'create_only');
      expect(codes(result.errors)).toEqual(['WAREHOUSE_NOT_FOUND', 'WAREHOUSE_INACTIVE', 'WAREHOUSE_NOT_ALLOWED']);
    });

    it('refuses negative and decimal quantities', () => {
      const result = validateImportRow(row({ stock: { 'HK-01': '-1' } }), lookups(), 'create_only');
      expect(codes(result.errors)).toEqual(['STOCK_INVALID']);
      expect(codes(validateImportRow(row({ stock: { 'HK-01': '2.5' } }), lookups(), 'create_only').errors)).toEqual(['STOCK_INVALID']);
    });
  });
});

describe('validateImportRows', () => {
  it('flags the second occurrence of the same brand and code, in any case', () => {
    const results = validateImportRows([row({ rowNumber: 2 }), row({ rowNumber: 3, code: '6205-2rs' }), row({ rowNumber: 4, code: '6206' })], lookups(), 'create_only');
    expect(results.map((r) => r.status)).toEqual(['valid', 'error', 'valid']);
    expect(codes(results[1].errors)).toEqual(['DUPLICATE_IN_FILE']);
  });
});

describe('planStockChanges', () => {
  it('opens the stock with an INITIAL movement when the product never had any', () => {
    expect(planStockChanges(8, { quantity: 0, hasHistory: false })).toEqual({ type: 'INITIAL', quantity: 8 });
  });

  it('adjusts by the difference when there is a level', () => {
    expect(planStockChanges(15, { quantity: 10, hasHistory: true })).toEqual({ type: 'ADJUSTMENT_IN', quantity: 5 });
    expect(planStockChanges(4, { quantity: 10, hasHistory: true })).toEqual({ type: 'ADJUSTMENT_OUT', quantity: -6 });
  });

  it('adjusts, not initial, when the level is empty but has history', () => {
    expect(planStockChanges(3, { quantity: 0, hasHistory: true })).toEqual({ type: 'ADJUSTMENT_IN', quantity: 3 });
  });

  it('writes nothing when the quantity is already right', () => {
    expect(planStockChanges(10, { quantity: 10, hasHistory: true })).toBeNull();
    expect(planStockChanges(0, { quantity: 0, hasHistory: false })).toBeNull();
  });
});

describe('parseStockQuantity', () => {
  it('accepts whole numbers only', () => {
    expect(parseStockQuantity(' 12 ')).toBe(12);
    expect(parseStockQuantity('0')).toBe(0);
    expect(parseStockQuantity('1.5')).toBeNull();
    expect(parseStockQuantity('-3')).toBeNull();
    expect(parseStockQuantity('abc')).toBeNull();
  });
});

describe('summarizeImport', () => {
  it('counts the valid rows, the errors, the warnings and the stock value', () => {
    const results = validateImportRows(
      [
        row({ rowNumber: 2, stock: { 'HK-01': '10' }, unitCost: '12,5' }),
        row({ rowNumber: 3, code: '6206', stock: { 'HK-01': '5' }, unitCost: '2' }),
        row({ rowNumber: 4, code: '6207', brand: 'Nueva' }),
      ],
      lookups(),
      'create_only',
    );
    expect(summarizeImport(results)).toEqual({
      total: 3,
      valid: 2,
      withError: 1,
      withWarning: 0,
      toCreate: 2,
      toUpdate: 0,
      pieces: 15,
      value: '135.00',
    });
  });
});

describe('describeImportIssue', () => {
  it('writes the issue in Spanish, with its parameters', () => {
    expect(describeImportIssue({ field: 'brand', code: 'BRAND_NOT_FOUND' })).toBe('Marca no existe');
    expect(describeImportIssue({ field: 'Stock HK-01', code: 'STOCK_WILL_ADJUST', params: { warehouse: 'HK-01', from: 10, to: 25 } })).toBe(
      'Ajustará el stock de 10 a 25',
    );
  });
});
