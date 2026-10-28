import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateWarehouseDto, ListWarehousesQueryDto, UpdateWarehouseDto } from './warehouses.dto';

const BRANCH = '0198a0a0-0000-7000-8000-000000000001';

const errorsOf = <T extends object>(cls: new () => T, plain: object) => validateSync(plainToInstance(cls, plain)).map((e) => e.property);

describe('CreateWarehouseDto', () => {
  it('normalizes the code to upper case and trims the name', () => {
    const dto = plainToInstance(CreateWarehouseDto, { code: ' hk-02 ', name: '  Central ', branchId: BRANCH });
    expect(dto).toMatchObject({ code: 'HK-02', name: 'Central' });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects a malformed code, a blank name and a missing branch', () => {
    expect(errorsOf(CreateWarehouseDto, { code: 'H', name: 'x', branchId: BRANCH })).toEqual(['code']);
    expect(errorsOf(CreateWarehouseDto, { code: 'HK_02', name: 'x', branchId: BRANCH })).toEqual(['code']);
    expect(errorsOf(CreateWarehouseDto, { code: 'HK-02', name: '   ', branchId: BRANCH })).toEqual(['name']);
    expect(errorsOf(CreateWarehouseDto, { code: 'HK-02', name: 'x' })).toEqual(['branchId']);
  });

  it('stores an empty location note as null', () => {
    const dto = plainToInstance(CreateWarehouseDto, { code: 'HK-02', name: 'x', branchId: BRANCH, locationNote: '  ' });
    expect(dto.locationNote).toBeNull();
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('caps the location note', () => {
    expect(errorsOf(CreateWarehouseDto, { code: 'HK-02', name: 'x', branchId: BRANCH, locationNote: 'a'.repeat(201) })).toEqual(['locationNote']);
  });
});

describe('UpdateWarehouseDto', () => {
  it('accepts a partial body', () => {
    expect(errorsOf(UpdateWarehouseDto, { isMain: true })).toEqual([]);
    expect(errorsOf(UpdateWarehouseDto, { status: 'INACTIVE', expectedUpdatedAt: '2026-10-28T12:00:00.000Z' })).toEqual([]);
  });

  it('rejects an unknown status and a bad timestamp', () => {
    expect(errorsOf(UpdateWarehouseDto, { status: 'DRAFT' })).toEqual(['status']);
    expect(errorsOf(UpdateWarehouseDto, { expectedUpdatedAt: 'yesterday' })).toEqual(['expectedUpdatedAt']);
  });
});

describe('ListWarehousesQueryDto', () => {
  it('coerces the paging numbers and rejects out-of-range values', () => {
    const dto = plainToInstance(ListWarehousesQueryDto, { page: '2', pageSize: '50' });
    expect(dto).toMatchObject({ page: 2, pageSize: 50 });
    expect(errorsOf(ListWarehousesQueryDto, { pageSize: '500' })).toEqual(['pageSize']);
    expect(errorsOf(ListWarehousesQueryDto, { branchId: 'nope' })).toEqual(['branchId']);
  });
});
