import { formatDifference, formatRelativeDateTime, registerPlace } from './cash-format';

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
