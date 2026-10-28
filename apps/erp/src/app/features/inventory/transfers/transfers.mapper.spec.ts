import type { TransferListItem } from '@rodasoft/domain';
import { parseDay, parseStatus, rangeLabel, toQuery, toRow, TRANSFER_STATUS_PILLS } from './transfers.mapper';

const item = (over: Partial<TransferListItem> = {}): TransferListItem => ({
  id: 't1',
  number: 'TR-000123',
  status: 'IN_TRANSIT',
  origin: { id: 'w1', name: 'Almacén Central', branch: { id: 'b1', name: 'Central' } },
  destination: { id: 'w2', name: 'Almacén Norte', branch: { id: 'b2', name: 'Norte' } },
  products: 12,
  pieces: 340,
  value: '1280.00',
  createdBy: 'Ana',
  createdAt: '2026-10-28T15:00:00.000Z',
  sentAt: null,
  ...over,
});

describe('toRow', () => {
  it('shows the number, the route, the status pill, the totals and the dates', () => {
    const row = toRow(item());
    expect(row.id).toBe('t1');
    expect(row.cells).toMatchObject({
      number: 'TR-000123',
      route: 'Central · Almacén Central → Norte · Almacén Norte',
      status: { label: 'En tránsito', status: 'info' },
      products: 12,
      pieces: 340,
      createdBy: 'Ana',
      sentAt: '–',
    });
    expect(String(row.cells['value'])).toContain('1.280,00');
    expect(String(row.cells['createdAt'])).toContain('2026');
  });

  it('shows a dash for a value the viewer cannot see and for an unknown creator', () => {
    expect(toRow(item({ value: null, createdBy: null })).cells).toMatchObject({ value: '–', createdBy: '–' });
  });

  it('has a pill for every status', () => {
    expect(Object.keys(TRANSFER_STATUS_PILLS)).toHaveLength(8);
    expect(TRANSFER_STATUS_PILLS.PENDING_APPROVAL.label).toBe('Pendiente de aprobación');
  });
});

describe('url filters', () => {
  it('accepts only known statuses and calendar days', () => {
    expect(parseStatus('DRAFT')).toBe('DRAFT');
    expect(parseStatus('nope')).toBeNull();
    expect(parseStatus('toString')).toBeNull();
    expect(parseDay('2026-10-28')).toBe('2026-10-28');
    expect(parseDay('28/10/2026')).toBeNull();
  });

  it('leaves empty filters out of the API query', () => {
    expect(toQuery({ q: '', status: null, originWarehouseId: null, destinationWarehouseId: null, from: null, to: null, page: 2 })).toEqual({
      q: undefined,
      status: undefined,
      originWarehouseId: undefined,
      destinationWarehouseId: undefined,
      from: undefined,
      to: undefined,
      page: 2,
      pageSize: 10,
    });
  });
});

describe('rangeLabel', () => {
  it('says which transfers are shown, with the plural', () => {
    expect(rangeLabel(1, 10, 23)).toBe('1–10 de 23 transferencias');
    expect(rangeLabel(3, 3, 23)).toBe('21–23 de 23 transferencias');
    expect(rangeLabel(1, 1, 1)).toBe('1–1 de 1 transferencia');
    expect(rangeLabel(1, 0, 0)).toBe('');
  });
});
