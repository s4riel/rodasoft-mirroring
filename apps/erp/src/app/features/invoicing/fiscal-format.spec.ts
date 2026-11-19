import type { FiscalChecklistRow, HomologationRow, PointOfSaleListItem, VatPeriodRow } from '@rodasoft/domain';
import { BLOCKER_LABELS, fileSizeLabel, periodMenuFor, sectionDetail, toHomologationRow, toPeriodRow, toPointOfSaleRow } from './fiscal-format';

describe('fiscal-format', () => {
  it('writes the size of a file in KB with one decimal', () => {
    expect(fileSizeLabel(2048)).toBe('2.0 KB');
    expect(fileSizeLabel(12595)).toBe('12.3 KB');
  });

  const period = (over: Partial<VatPeriodRow> = {}): VatPeriodRow => ({
    period: '2026-10',
    status: 'CLOSED',
    salesTotal: '1280.00',
    fiscalDebit: '166.40',
    purchasesTotal: '500.00',
    vatCredit: '65.00',
    salesCount: 12,
    purchasesCount: 4,
    closedAt: '2026-11-03T14:00:00.000Z',
    filedAt: null,
    actions: ['VIEW_BOOKS', 'FILE', 'REOPEN'],
    ...over,
  });

  it('turns a period into a row with its month, totals and status', () => {
    const row = toPeriodRow(period());
    expect(row.id).toBe('2026-10');
    expect(row.cells).toMatchObject({ period: 'Octubre 2026', sales: '12', purchases: '4', status: { label: 'Cerrado' } });
  });

  it('builds the row menu from the actions, in order', () => {
    expect(periodMenuFor(period()).map((item) => item.key)).toEqual(['books', 'file', 'reopen']);
    expect(periodMenuFor(period({ actions: [] }))).toEqual([]);
  });

  it('writes the blockers in singular and plural', () => {
    expect(BLOCKER_LABELS.INVOICES_NOT_ISSUED(1)).toBe('1 factura sin emitir en el SIAT');
    expect(BLOCKER_LABELS.INVOICES_NOT_ISSUED(3)).toBe('3 facturas sin emitir en el SIAT');
    expect(BLOCKER_LABELS.PURCHASES_OBSERVED(1)).toBe('1 compra observada');
    expect(BLOCKER_LABELS.CANCELLATIONS_IN_PROGRESS(2)).toBe('2 anulaciones en curso en el SIAT');
  });

  it('describes a checklist row, or nothing without a detail', () => {
    const row = (key: FiscalChecklistRow['key'], detail: string | null): FiscalChecklistRow => ({ key, status: 'OK', detail });
    expect(sectionDetail(row('SIGNATURE', '2027-11-01T14:00:00.000Z'))).toBe('Vence el 01/11/2027');
    expect(sectionDetail(row('POINTS_OF_SALE', '1'))).toBe('1 activo');
    expect(sectionDetail(row('POINTS_OF_SALE', '3'))).toBe('3 activos');
    expect(sectionDetail(row('HOMOLOGATION', '8/10'))).toBe('8/10 productos');
    expect(sectionDetail(row('ACTIVITY', null))).toBe('');
  });

  it('shows a point of sale with its last invoice padded and its CUIS pill', () => {
    const point: PointOfSaleListItem = { id: 'p', branchId: 'b', branchName: 'Central', code: 2, name: 'Caja 2', typeCode: 5, registerName: null, lastInvoiceNumber: 15, cuisHealth: 'EXPIRING', cuisExpiresAt: null, status: 'ACTIVE' };
    expect(toPointOfSaleRow(point).cells).toMatchObject({ code: '2', point: 'Caja 2', register: '—', lastInvoice: '000015', cuis: { label: 'Por vencer' }, status: { label: 'Activo' } });
    expect(toPointOfSaleRow({ ...point, status: 'INACTIVE' }).cells).toMatchObject({ cuis: { label: 'Sin uso' }, status: { label: 'Inactivo' } });
  });

  it('shows a product with its SIN code and status', () => {
    const product: HomologationRow = { id: 'r', sku: 'RL-1', code: 'C', name: 'Rodamiento', brand: null, sinProductCode: null, sinActivityCode: null, sinUnitCode: null, sinDescription: null, status: 'PENDING' };
    expect(toHomologationRow(product).cells).toMatchObject({ product: 'Rodamiento', sin: '—', unit: '—', status: { label: 'Pendiente' } });
    expect(toHomologationRow({ ...product, sinProductCode: '84821', sinDescription: 'BOLAS', sinUnitCode: 58, status: 'DONE' }).cells).toMatchObject({ sin: '84821 · BOLAS', unit: '58', status: { label: 'Homologado' } });
  });
});
