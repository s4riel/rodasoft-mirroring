import { facturaMachine, InvalidTransitionError, transferenciaMachine } from './state-machine';

describe('máquinas de estado', () => {
  it('transferencia sobre el límite pasa por aprobación', () => {
    let s = transferenciaMachine.next('BORRADOR', 'pedirAprobacion');
    s = transferenciaMachine.next(s, 'aprobar');
    s = transferenciaMachine.next(s, 'despachar');
    s = transferenciaMachine.next(s, 'recibirParcial');
    expect(transferenciaMachine.next(s, 'recibirTodo')).toBe('RECIBIDA');
  });

  it('no se puede anular una transferencia en tránsito', () => {
    expect(() => transferenciaMachine.next('EN_TRANSITO', 'anular')).toThrow(InvalidTransitionError);
  });

  it('la factura sigue válida hasta que Gerencia aprueba la anulación', () => {
    const s = facturaMachine.next('VALIDA', 'solicitarAnulacion');
    expect(s).toBe('ANULACION_PENDIENTE');
    expect(facturaMachine.next(s, 'rechazarAnulacion')).toBe('VALIDA');
    expect(facturaMachine.events('ANULADA')).toEqual([]);
  });
});
