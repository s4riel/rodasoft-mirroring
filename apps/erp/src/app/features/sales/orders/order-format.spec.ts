import type { SalesOrderDetail } from '@rodasoft/domain';
import { dispatchOrderDocument, lineStatus, piecesLabel, toOrderTimelineSteps } from './order-format';

describe('order format', () => {
  it('says pieces in singular and plural', () => {
    expect(piecesLabel(1)).toBe('1 pieza');
    expect(piecesLabel(0)).toBe('0 piezas');
    expect(piecesLabel(19)).toBe('19 piezas');
  });

  it('a line with nothing pending is ready, otherwise it says how many are pending', () => {
    expect(lineStatus({ pendingQuantity: 0 })).toEqual({ label: 'Listo', status: 'success' });
    expect(lineStatus({ pendingQuantity: 3 })).toEqual({ label: 'Pendiente 3', status: 'warning' });
  });

  it('draws the timeline with a short date, "Pendiente" under the current step and a dash otherwise', () => {
    const steps = toOrderTimelineSteps([
      { key: 'created', state: 'done', at: '2026-10-15T15:00:00.000Z' },
      { key: 'reserved', state: 'done', at: '2026-10-15T15:00:00.000Z' },
      { key: 'dispatch', state: 'current', at: null },
      { key: 'invoiced', state: 'pending', at: null },
      { key: 'completed', state: 'pending', at: null },
    ]);
    expect(steps.map((s) => s.label)).toEqual(['Creado', 'Reservado', 'Despacho parcial', 'Facturado', 'Completado']);
    expect(steps.map((s) => s.caption)).toEqual(['15/10', '15/10', 'Pendiente', '—', '—']);
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'current', 'pending', 'pending']);
  });

  it('the dispatch order lists only what is pending and the total to pick', () => {
    const order = {
      number: 'PED-000032',
      createdAt: '2026-10-15T15:00:00.000Z',
      customer: { name: 'Minera Demo Ltda.' },
      branchName: 'Sucursal central',
      warehouseName: 'Huayna Kapac',
      lines: [
        { code: '6205-2RS', name: 'Rodamiento SKF', quantity: 12, dispatchedQuantity: 12, pendingQuantity: 0 },
        { code: '6306-2RS', name: 'Rodamiento NSK', quantity: 6, dispatchedQuantity: 3, pendingQuantity: 3 },
      ],
    } as unknown as SalesOrderDetail;
    const doc = dispatchOrderDocument(order);
    expect(doc.items).toHaveLength(1);
    expect(doc.items[0].description).toBe('6306-2RS · Rodamiento NSK');
    expect(doc.items[0].total).toBe('3 piezas');
    expect(doc.totalRows).toEqual([{ label: 'Por despachar', value: '3 piezas', strong: true }]);
    expect(doc.metaRows.map((r) => r.value)).toContain('PED-000032');
  });
});
