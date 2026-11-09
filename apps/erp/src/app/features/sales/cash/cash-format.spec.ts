import { formatDifference, formatOpenedAt, formatRelativeDateTime, formatTime, movementConceptLabel, movementStatusPill, registerPlace, signedAmount } from './cash-format';

describe('formatRelativeDateTime', () => {
  const now = new Date('2026-11-04T15:00:00.000Z'); // 11:00 in La Paz

  it('says Hoy for the same day and Ayer for the day before, in the business timezone', () => {
    expect(formatRelativeDateTime('2026-11-04T13:15:00.000Z', now)).toBe('Hoy 09:15');
    expect(formatRelativeDateTime('2026-11-03T23:02:00.000Z', now)).toBe('Ayer 19:02');
  });

  it('writes the date for older closes', () => {
    expect(formatRelativeDateTime('2026-11-02T22:30:00.000Z', now)).toBe('02/11/2026 18:30');
  });
});

describe('formatDifference', () => {
  it('describes a zero, a non-zero and an unknown difference', () => {
    expect(formatDifference('0.00')).toBe('sin diferencia');
    expect(formatDifference('5.00')).toBe('diferencia Bs 5,00');
    expect(formatDifference(null)).toBeNull();
  });
});

describe('registerPlace', () => {
  it('adds the branch, unless the register name already has it', () => {
    expect(registerPlace({ name: 'Caja 1', branch: { name: 'Huayna Kapac' } })).toBe('Caja 1 · Huayna Kapac');
    expect(registerPlace({ name: 'Caja 1 · Huayna Kapac', branch: { name: 'Huayna Kapac' } })).toBe('Caja 1 · Huayna Kapac');
  });
});

describe('cash movement formats (HU-VEN-22)', () => {
  it('labels the concept in Spanish, with the detail for Otro', () => {
    expect(movementConceptLabel({ type: 'EXPENSE', concept: 'FREIGHT', detail: 'Flete a Oruro' })).toBe('Pago de flete');
    expect(movementConceptLabel({ type: 'INCOME', concept: 'BALANCE_COLLECTION', detail: null })).toBe('Cobro de saldo');
    expect(movementConceptLabel({ type: 'EXPENSE', concept: 'OTHER', detail: 'Propina' })).toBe('Otro: Propina');
    expect(movementConceptLabel({ type: 'REFUND', concept: null, detail: 'Devolución DEV-000001' })).toBe('Devolución DEV-000001');
  });

  it('shows a pill only for an expense that is not posted', () => {
    expect(movementStatusPill('POSTED')).toBeNull();
    expect(movementStatusPill('PENDING')).toEqual({ label: 'Por aprobar', status: 'warning' });
    expect(movementStatusPill('REJECTED')).toEqual({ label: 'Rechazada', status: 'danger' });
    expect(movementStatusPill('WITHDRAWN')).toEqual({ label: 'Retirada', status: 'idle' });
  });

  it('signs the amount by the direction of the money', () => {
    expect(signedAmount('INCOME', '50.00')).toBe('+ Bs 50,00');
    expect(signedAmount('SALE_PAYMENT', '1200.50')).toBe('+ Bs 1.200,50');
    expect(signedAmount('EXPENSE', '30.00')).toBe('− Bs 30,00');
    expect(signedAmount('REFUND', '10.00')).toBe('− Bs 10,00');
  });

  it('writes the time and when the shift was opened in the business timezone', () => {
    const now = new Date('2026-11-04T15:00:00.000Z'); // 11:00 in La Paz
    expect(formatTime('2026-11-04T12:02:00.000Z')).toBe('08:02');
    expect(formatOpenedAt('2026-11-04T12:02:00.000Z', now)).toBe('hoy a las 08:02');
    expect(formatOpenedAt('2026-11-03T23:02:00.000Z', now)).toBe('ayer a las 19:02');
    expect(formatOpenedAt('2026-11-02T22:30:00.000Z', now)).toBe('el 02/11/2026 a las 18:30');
  });
});
