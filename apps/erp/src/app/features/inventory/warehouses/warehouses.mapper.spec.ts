import type { WarehouseListItem } from '@rodasoft/domain';
import { fieldOfError, parseStatus, rangeLabel, toQuery, toRow, WAREHOUSES_PAGE_SIZE } from './warehouses.mapper';

const item = (over: Partial<WarehouseListItem> = {}): WarehouseListItem => ({
  id: 'w1',
  code: 'HK-01',
  name: 'Principal',
  branch: { id: 'b1', name: 'Huayna Kapac' },
  isMain: true,
  visibleInStore: true,
  status: 'ACTIVE',
  productCount: 12,
  totalUnits: 340,
  ...over,
});

describe('toRow', () => {
  it('shows the main flag, store visibility and status as pills', () => {
    expect(toRow(item()).cells).toMatchObject({
      code: 'HK-01',
      branch: 'Huayna Kapac',
      main: { label: 'Principal', status: 'info' },
      visibleInStore: { label: 'Visible', status: 'success' },
      products: 12,
      units: 340,
      status: { label: 'Activo', status: 'success' },
    });
  });

  it('leaves the main cell empty for a secondary warehouse and flags hidden and inactive ones', () => {
    const row = toRow(item({ isMain: false, visibleInStore: false, status: 'INACTIVE' }));
    expect(row.cells['main']).toBeNull();
    expect(row.cells['visibleInStore']).toEqual({ label: 'Oculto', status: 'idle' });
    expect(row.cells['status']).toEqual({ label: 'Inactivo', status: 'idle' });
  });
});

describe('toQuery', () => {
  it('leaves empty filters out and asks for the page size of the table', () => {
    expect(toQuery({ q: '', branchId: null, status: null, page: 1 })).toEqual({
      q: undefined,
      branchId: undefined,
      status: undefined,
      page: 1,
      pageSize: WAREHOUSES_PAGE_SIZE,
    });
    expect(toQuery({ q: 'hk', branchId: 'b1', status: 'ACTIVE', page: 2 })).toMatchObject({ q: 'hk', branchId: 'b1', status: 'ACTIVE', page: 2 });
  });
});

describe('parseStatus', () => {
  it('accepts only the two statuses', () => {
    expect(parseStatus('ACTIVE')).toBe('ACTIVE');
    expect(parseStatus('INACTIVE')).toBe('INACTIVE');
    expect(parseStatus('DRAFT')).toBeNull();
    expect(parseStatus(null)).toBeNull();
  });
});

describe('rangeLabel', () => {
  it('names the rows on the page, singular or plural', () => {
    expect(rangeLabel(1, 10, 23)).toBe('1–10 de 23 almacenes');
    expect(rangeLabel(3, 3, 23)).toBe('21–23 de 23 almacenes');
    expect(rangeLabel(1, 1, 1)).toBe('1–1 de 1 almacén');
    expect(rangeLabel(1, 0, 0)).toBe('');
  });
});

describe('fieldOfError', () => {
  it('ties the code error to the code field and the branch errors to the branch field', () => {
    expect(fieldOfError('WAREHOUSE_CODE_EXISTS')).toBe('code');
    expect(fieldOfError('BRANCH_INVALID')).toBe('branchId');
    expect(fieldOfError('WAREHOUSE_BRANCH_LOCKED')).toBe('branchId');
    expect(fieldOfError('WAREHOUSE_HAS_STOCK')).toBeNull();
  });
});
