import {
  canDeactivateWarehouse,
  clampWarehousePageSize,
  normalizeWarehouseCode,
  WAREHOUSE_CODE_PATTERN,
  WAREHOUSE_PAGE_SIZE_DEFAULT,
  WAREHOUSE_PAGE_SIZE_MAX,
} from './warehouse';

describe('normalizeWarehouseCode', () => {
  it('trims and upper-cases', () => {
    expect(normalizeWarehouseCode('  hk-02 ')).toBe('HK-02');
  });
});

describe('WAREHOUSE_CODE_PATTERN', () => {
  it.each(['HK-01', 'A1', 'DEPOSITO-01'])('accepts %s', (code) => {
    expect(WAREHOUSE_CODE_PATTERN.test(code)).toBe(true);
  });

  it.each(['H', 'hk-01', 'HK 01', 'HK_01', 'ABCDEFGHIJKLM', '', 'ÑU-1'])('rejects %j', (code) => {
    expect(WAREHOUSE_CODE_PATTERN.test(code)).toBe(false);
  });
});

describe('canDeactivateWarehouse', () => {
  it('allows an empty secondary warehouse', () => {
    expect(canDeactivateWarehouse({ totalUnits: 0, isMain: false })).toBe('ok');
  });

  it('blocks a warehouse with units', () => {
    expect(canDeactivateWarehouse({ totalUnits: 3, isMain: false })).toBe('HAS_STOCK');
  });

  it('blocks the main warehouse even when empty', () => {
    expect(canDeactivateWarehouse({ totalUnits: 0, isMain: true })).toBe('MAIN_REQUIRED');
  });

  it('reports the stock first when both apply', () => {
    expect(canDeactivateWarehouse({ totalUnits: 1, isMain: true })).toBe('HAS_STOCK');
  });
});

describe('clampWarehousePageSize', () => {
  it('defaults and caps', () => {
    expect(clampWarehousePageSize(undefined)).toBe(WAREHOUSE_PAGE_SIZE_DEFAULT);
    expect(clampWarehousePageSize(0)).toBe(WAREHOUSE_PAGE_SIZE_DEFAULT);
    expect(clampWarehousePageSize(500)).toBe(WAREHOUSE_PAGE_SIZE_MAX);
    expect(clampWarehousePageSize(10.9)).toBe(10);
  });
});
