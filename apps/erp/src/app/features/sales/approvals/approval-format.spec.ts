import {
  APPROVAL_GROUP_LABELS,
  APPROVAL_TYPE_LABELS,
  approvalAmount,
  approvalDescription,
  approvalDetail,
  approvalDetailLink,
  approvalReasonLabel,
  approvalTitle,
  approvalTone,
  canDecideInline,
  decisionHeading,
  oldestText,
} from './approval-format';
import { approvalItem, CANCELLATION_ITEM, DIFFERENCE_ITEM, EXPENSE_ITEM, RETURN_ITEM } from './approvals.testing';

describe('approval formats (HU-VEN-29)', () => {
  it('names each type once for the card and once for the section', () => {
    expect(Object.values(APPROVAL_TYPE_LABELS)).toEqual(['Anulación', 'Diferencia de caja', 'Devolución', 'Gasto de caja']);
    expect(Object.values(APPROVAL_GROUP_LABELS)).toEqual(['Anulaciones', 'Diferencias de caja', 'Devoluciones', 'Gastos de caja']);
  });

  it('translates the reason of each type', () => {
    expect(approvalReasonLabel(CANCELLATION_ITEM)).toBe('Error en datos del cliente');
    expect(approvalReasonLabel(RETURN_ITEM)).toBe('Producto con falla de fábrica');
    expect(approvalReasonLabel(EXPENSE_ITEM)).toBe('Pago de flete');
    expect(approvalReasonLabel(DIFFERENCE_ITEM)).toBe('Diferencia al cerrar la caja');
    expect(approvalReasonLabel(approvalItem({ reason: null }))).toBe('');
    // a code the screen does not know is shown as it came, not hidden
    expect(approvalReasonLabel(approvalItem({ reason: 'NEW_CODE' }))).toBe('NEW_CODE');
  });

  it('titles a card with the document and, when there is one, the customer', () => {
    expect(approvalTitle(CANCELLATION_ITEM)).toBe('V-000231');
    expect(approvalTitle({ ...CANCELLATION_ITEM, customerName: 'Minera Demo Ltda.' })).toBe('V-000231 · Minera Demo Ltda.');
    expect(approvalTitle(DIFFERENCE_ITEM)).toBe('Turno T-0142 · Caja 1');
    expect(approvalTitle(RETURN_ITEM)).toBe('DEV-000012 · venta V-000231 · Minera Demo Ltda.');
    expect(approvalTitle({ ...RETURN_ITEM, customerName: null })).toBe('DEV-000012 · venta V-000231');
    expect(approvalTitle(EXPENSE_ITEM)).toBe('Egreso de Caja 2 · turno T-0143');
  });

  it('describes who asked, why, how many pieces and how long ago', () => {
    const now = new Date('2026-11-11T15:00:00.000Z');
    expect(approvalDescription({ ...RETURN_ITEM, requestedAt: '2026-11-11T12:00:00.000Z' }, now)).toBe('Ana Cajera · Producto con falla de fábrica · 2 piezas · hace 3 horas');
    expect(approvalDescription({ ...RETURN_ITEM, pieces: 1, requestedAt: '2026-11-11T14:59:00.000Z' }, now)).toBe('Ana Cajera · Producto con falla de fábrica · 1 pieza · hace 1 minuto');
    expect(approvalDescription({ ...EXPENSE_ITEM, requestedAt: '2026-11-09T15:00:00.000Z' }, now)).toBe('Ana Cajera · Pago de flete · hace 2 días');
  });

  it('quotes what the requester wrote', () => {
    expect(approvalDetail({ comment: 'Flete a Oruro' })).toBe('“Flete a Oruro”');
    expect(approvalDetail({ comment: '   ' })).toBe('');
    expect(approvalDetail({ comment: null })).toBe('');
  });

  it('formats the signed amount and tints what leaves the company', () => {
    expect(approvalAmount({ amount: '-200.00' })).toBe('−Bs 200,00');
    expect(approvalAmount({ amount: null })).toBe('');
    expect(approvalTone({ amount: '-200.00' })).toBe('negative');
    // a surplus in the drawer is not a loss
    expect(approvalTone({ amount: '15.00' })).toBe('neutral');
    expect(approvalTone({ amount: null })).toBe('neutral');
  });

  it('sends "Ver detalle" to the review page of each type', () => {
    expect(approvalDetailLink(CANCELLATION_ITEM)).toBe('/sales/history/sale1/cancellation');
    expect(approvalDetailLink(DIFFERENCE_ITEM)).toBe('/sales/cash-register/shifts/shift1/review');
    expect(approvalDetailLink(RETURN_ITEM)).toBe('/sales/returns/ret1');
    expect(approvalDetailLink(EXPENSE_ITEM)).toBe('/sales/cash-register/movements/mov1');
  });

  it('decides inline only a return or a cash expense the caller may decide', () => {
    expect(canDecideInline(RETURN_ITEM)).toBe(true);
    expect(canDecideInline(EXPENSE_ITEM)).toBe(true);
    expect(canDecideInline(CANCELLATION_ITEM)).toBe(false);
    expect(canDecideInline(DIFFERENCE_ITEM)).toBe(false);
    expect(canDecideInline({ ...RETURN_ITEM, canDecide: false })).toBe(false);
  });

  it('shows how long the oldest request has waited', () => {
    const now = new Date('2026-11-11T15:00:00.000Z');
    expect(oldestText(null, now)).toBe('—');
    expect(oldestText('2026-11-11T14:20:00.000Z', now)).toBe('hace 40 min');
    expect(oldestText('2026-11-11T12:00:00.000Z', now)).toBe('hace 3 h');
    expect(oldestText('2026-11-08T15:00:00.000Z', now)).toBe('hace 3 d');
  });

  it('heads the decision dialog', () => {
    expect(decisionHeading('RETURN', 'approve')).toBe('Aprobar devolución');
    expect(decisionHeading('RETURN', 'reject')).toBe('Rechazar devolución');
    expect(decisionHeading('CASH_EXPENSE', 'approve')).toBe('Aprobar gasto de caja');
    expect(decisionHeading('CASH_EXPENSE', 'reject')).toBe('Rechazar gasto de caja');
  });
});
