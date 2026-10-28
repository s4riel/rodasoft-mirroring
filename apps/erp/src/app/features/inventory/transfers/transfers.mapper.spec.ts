import type { TransferListItem } from '@rodasoft/domain';
import {
  detailOf,
  formatNumericDay,
  parseStatus,
  rangeLabel,
  routeOf,
  rowMenuOf,
  STATUS_OPTIONS,
  toCsv,
  toQuery,
  toRow,
  toTotals,
  TRANSFER_STATUS_PILLS,
} from './transfers.mapper';

const item = (over: Partial<TransferListItem> = {}): TransferListItem => ({
  id: 't1',
  number: 'TR-000123',
  status: 'IN_TRANSIT',
  origin: { id: 'w1', name: 'Almacén Central', branch: { id: 'b1', name: 'Huayna Kapac' } },
  destination: { id: 'w2', name: 'Almacén Norte', branch: { id: 'b2', name: 'Sacaba' } },
  products: 12,
  pieces: 340,
  value: '1280.00',
  createdBy: 'Ana',
  sentBy: 'Alberto Andia',
  createdAt: '2026-10-13T15:00:00.000Z',
  sentAt: '2026-10-14T16:00:00.000Z',
  ...over,
});

describe('toRow (the columns of IN-05)', () => {
  it('shows the number, the branches, what happened, the items, the day and the status pill', () => {
    const row = toRow(item());
    expect(row.id).toBe('t1');
    expect(row.label).toBe('TR-000123');
    expect(row.cells).toEqual({
      number: 'TR-000123',
      route: 'Huayna Kapac → Sacaba',
      detail: 'Enviada por Alberto Andia',
      products: 12,
      date: '14/10/2026',
      status: { label: 'En tránsito', status: 'info', icon: 'alert' },
    });
  });

  it('dates a draft by the day it was created', () => {
    expect(toRow(item({ status: 'DRAFT', sentAt: null, sentBy: null })).cells['date']).toBe('13/10/2026');
  });
});

describe('routeOf', () => {
  it('names the branches, and adds the warehouses only when both sides are the same branch', () => {
    expect(routeOf(item())).toBe('Huayna Kapac → Sacaba');
    const sameBranch = item({ destination: { id: 'w3', name: 'Depósito', branch: { id: 'b1', name: 'Huayna Kapac' } } });
    expect(routeOf(sameBranch)).toBe('Huayna Kapac · Almacén Central → Depósito');
  });
});

describe('detailOf', () => {
  it('says who sent it, who started a draft, and falls back when the name is unknown', () => {
    expect(detailOf(item())).toBe('Enviada por Alberto Andia');
    expect(detailOf(item({ sentBy: null }))).toBe('Enviada');
    expect(detailOf(item({ status: 'DRAFT' }))).toBe('Borrador de Ana');
    expect(detailOf(item({ status: 'DRAFT', createdBy: null }))).toBe('Borrador');
    expect(detailOf(item({ status: 'PENDING_APPROVAL' }))).toContain('aprobación');
    expect(detailOf(item({ status: 'CANCELLED' }))).toBe('Cancelada');
  });
});

describe('STATUS_OPTIONS', () => {
  it('offers the statuses a transfer can reach, without the approval ones', () => {
    expect(STATUS_OPTIONS.map((o) => o.value)).toEqual(['DRAFT', 'IN_TRANSIT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']);
    expect(STATUS_OPTIONS.map((o) => o.label).join(' ')).not.toContain('aprobación');
  });
});

describe('status pills', () => {
  it('has a pill for every status, with a check for success and an alert for the other colors', () => {
    expect(Object.keys(TRANSFER_STATUS_PILLS)).toHaveLength(8);
    expect(TRANSFER_STATUS_PILLS.PENDING_APPROVAL.label).toBe('Pendiente de aprobación');
    expect(TRANSFER_STATUS_PILLS.RECEIVED).toMatchObject({ status: 'success', icon: 'check' });
    expect(TRANSFER_STATUS_PILLS.REJECTED).toMatchObject({ status: 'danger', icon: 'alert' });
    expect(TRANSFER_STATUS_PILLS.DRAFT.icon).toBeUndefined();
  });
});

describe('toTotals', () => {
  it('counts the transfers of the page and adds their items', () => {
    expect(toTotals([item(), item({ id: 't2', products: 5 })])).toEqual({
      number: 'Total',
      route: '2 transferencias',
      detail: '',
      products: 17,
      date: '—',
      status: '—',
    });
    expect(toTotals([item()]).route).toBe('1 transferencia');
  });
});

describe('toCsv', () => {
  it('has a header and one line per transfer, with the sides of the route apart', () => {
    const csv = toCsv([item(), item({ number: 'TR-000124', status: 'DRAFT', sentAt: null, sentBy: null })]);
    const [header, first, second] = csv.split('\r\n');
    expect(header).toBe('N.º;Origen;Destino;Detalle;Ítems;Fecha;Estado');
    expect(first).toBe('TR-000123;Huayna Kapac · Almacén Central;Sacaba · Almacén Norte;Enviada por Alberto Andia;12;14/10/2026;En tránsito');
    expect(second).toContain('Borrador de Ana');
    expect(second.endsWith(';Borrador')).toBe(true);
  });

  it('quotes a field that holds the separator or a quote', () => {
    const csv = toCsv([item({ createdBy: 'Ana; "la jefa"', status: 'DRAFT', sentAt: null })]);
    expect(csv).toContain('"Borrador de Ana; ""la jefa"""');
  });
});

describe('rowMenuOf', () => {
  it('edits a draft and reads anything else', () => {
    expect(rowMenuOf({ status: 'DRAFT' })).toEqual([{ key: 'open', label: 'Editar borrador', icon: 'edit' }]);
    expect(rowMenuOf({ status: 'IN_TRANSIT' })).toEqual([{ key: 'open', label: 'Ver detalle', icon: 'eye' }]);
  });
});

describe('formatNumericDay', () => {
  it('uses the La Paz day, so a late evening in UTC is still the same day there', () => {
    expect(formatNumericDay('2026-10-14T02:00:00.000Z')).toBe('13/10/2026');
  });
});

describe('url filters', () => {
  it('accepts only known statuses', () => {
    expect(parseStatus('DRAFT')).toBe('DRAFT');
    expect(parseStatus('nope')).toBeNull();
    expect(parseStatus('toString')).toBeNull();
  });

  it('leaves empty filters out of the API query', () => {
    expect(toQuery({ q: '', status: null, originWarehouseId: null, destinationWarehouseId: null, page: 2 })).toEqual({
      q: undefined,
      status: undefined,
      originWarehouseId: undefined,
      destinationWarehouseId: undefined,
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
