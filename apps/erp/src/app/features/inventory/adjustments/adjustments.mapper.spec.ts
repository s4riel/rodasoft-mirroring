import type { AdjustmentListItem } from '@rodasoft/domain';
import {
  ADJUSTMENTS_PAGE_SIZE,
  adjustmentErrorMessage,
  AdjustmentUrlFilters,
  parseDate,
  parseReason,
  parseStatus,
  rangeLabel,
  toQuery,
  toRow,
  toTotals,
} from './adjustments.mapper';

const item = (over: Partial<AdjustmentListItem> = {}): AdjustmentListItem => ({
  id: 'a1',
  number: 'AJ-000007',
  status: 'APPROVED',
  source: 'MANUAL',
  warehouse: { id: 'w1', name: 'Principal', branch: { id: 'b1', name: 'Huayna Kapac' } },
  reason: 'Merma',
  lines: 3,
  value: '55.00',
  createdBy: 'Ana',
  createdAt: '2026-10-28T15:00:00.000Z',
  ...over,
});

describe('parsers', () => {
  it('accept only known statuses, reasons and ISO dates', () => {
    expect(parseStatus('APPROVED')).toBe('APPROVED');
    expect(parseStatus('NOPE')).toBeNull();
    expect(parseStatus(null)).toBeNull();
    expect(parseReason('DAMAGE')).toBe('DAMAGE');
    expect(parseReason('toString')).toBeNull();
    expect(parseDate('2026-10-28')).toBe('2026-10-28');
    expect(parseDate('28/10/2026')).toBeNull();
  });
});

describe('toQuery', () => {
  it('leaves out empty filters and asks for the page size of the table', () => {
    const filters: AdjustmentUrlFilters = { q: '', status: null, warehouseId: null, reason: 'DAMAGE', from: '2026-10-01', to: null, page: 2 };
    expect(toQuery(filters)).toEqual({
      q: undefined,
      status: undefined,
      warehouseId: undefined,
      reason: 'DAMAGE',
      from: '2026-10-01',
      to: undefined,
      page: 2,
      pageSize: ADJUSTMENTS_PAGE_SIZE,
    });
  });
});

describe('toRow', () => {
  it('shows number, date, warehouse, reason, lines, value, author and a status pill', () => {
    const row = toRow(item());
    expect(row.id).toBe('a1');
    expect(row.cells['number']).toBe('AJ-000007');
    expect(row.cells['date']).toBe('28/10/2026');
    expect(row.cells['warehouse']).toBe('Huayna Kapac · Principal');
    expect(row.cells['reason']).toBe('Merma');
    expect(row.cells['lines']).toBe(3);
    expect(row.cells['value']).toBe('Bs 55,00');
    expect(row.cells['createdBy']).toBe('Ana');
    expect(row.cells['status']).toMatchObject({ label: 'Aplicado', status: 'success' });
  });

  it('shows dashes for the value and the author when they are hidden or unknown', () => {
    const row = toRow(item({ value: null, createdBy: null, status: 'PENDING_APPROVAL' }));
    expect(row.cells['value']).toBe('–');
    expect(row.cells['createdBy']).toBe('–');
    expect(row.cells['status']).toMatchObject({ label: 'Pendiente de aprobación', status: 'warning' });
  });
});

describe('toTotals and rangeLabel', () => {
  it('totals the adjustments and the lines of the page', () => {
    expect(toTotals([item(), item({ id: 'a2' })])).toMatchObject({ number: 'Total', warehouse: '2 ajustes', lines: 6 });
    expect(toTotals([item()])).toMatchObject({ warehouse: '1 ajuste' });
  });

  it('words the range of the page', () => {
    expect(rangeLabel(1, 10, 23)).toBe('1–10 de 23 ajustes');
    expect(rangeLabel(3, 3, 23)).toBe('21–23 de 23 ajustes');
    expect(rangeLabel(1, 1, 1)).toBe('1–1 de 1 ajuste');
    expect(rangeLabel(1, 0, 0)).toBe('');
  });
});

describe('adjustmentErrorMessage', () => {
  it('translates the codes of the adjustment form and falls back to the server text', () => {
    expect(adjustmentErrorMessage({ code: 'REASON_REQUIRED', message: 'x' })).toBe('Elige el motivo del ajuste.');
    expect(adjustmentErrorMessage({ code: 'DUPLICATE_LINE', message: 'x' })).toContain('solo puede aparecer una vez');
    expect(adjustmentErrorMessage({ code: 'SOMETHING_NEW', message: 'server text' })).toBe('server text');
  });
});
