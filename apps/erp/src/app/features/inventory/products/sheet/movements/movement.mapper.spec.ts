import type { ProductMovementItem } from '@rodasoft/domain';
import { directionLabel, documentText, formatSigned } from './movement.mapper';

const item = (over: Partial<ProductMovementItem>): ProductMovementItem => ({
  id: 'm1',
  date: '2026-10-22T14:05:00Z',
  type: 'SALE',
  document: { refType: 'SALE', refNumber: 'V-00231' },
  quantity: -4,
  balanceAfter: 6,
  branch: { id: 'b1', name: 'Sucursal Centro' },
  warehouse: { id: 'w1', name: 'Almacén principal' },
  ...over,
});

describe('movement mapper', () => {
  it('names the source document with its Spanish label and number', () => {
    expect(documentText(item({}))).toBe('Venta V-00231');
    expect(
      documentText(item({ type: 'TRANSFER_IN', document: { refType: 'TRANSFER', refNumber: 'TR-0045' } })),
    ).toBe('Transferencia TR-0045');
    expect(
      documentText(item({ type: 'ADJUSTMENT_OUT', document: { refType: 'ADJUSTMENT', refNumber: 'AJ-0012' } })),
    ).toBe('Ajuste AJ-0012');
  });

  it('names a movement without a document by its type', () => {
    expect(documentText(item({ type: 'INITIAL', document: { refType: null, refNumber: null } }))).toBe('Stock inicial');
  });

  it('labels the direction from the sign of the quantity', () => {
    expect(directionLabel(item({ quantity: 26 }))).toBe('Entrada');
    expect(directionLabel(item({ quantity: -6 }))).toBe('Salida');
  });

  it('formats signed quantities with the typographic minus', () => {
    expect(formatSigned(26)).toBe('+26');
    expect(formatSigned(-6)).toBe('−6');
    expect(formatSigned(0)).toBe('0');
  });
});
