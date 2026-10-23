import { movementDirection, movementWindowStart } from './stock';

describe('movementDirection', () => {
  it('reads the sign of the quantity', () => {
    expect(movementDirection(4)).toBe('IN');
    expect(movementDirection(-4)).toBe('OUT');
  });
});

describe('movementWindowStart', () => {
  // La Paz is UTC−4 all year, so its midnight is 04:00 UTC of the same date.
  it('starts at La Paz midnight, 29 days before today for a 30-day window', () => {
    const now = new Date('2026-10-22T15:00:00Z'); // 11:00 in La Paz on 22 Oct
    expect(movementWindowStart(now, 30).toISOString()).toBe('2026-09-23T04:00:00.000Z');
  });

  it('uses the La Paz date, not the UTC date, near midnight', () => {
    // 02:00 UTC on 23 Oct is still 22 Oct in La Paz
    const now = new Date('2026-10-23T02:00:00Z');
    expect(movementWindowStart(now, 1).toISOString()).toBe('2026-10-22T04:00:00.000Z');
  });

  it('includes a movement made just after La Paz midnight and excludes one from just before it', () => {
    const start = movementWindowStart(new Date('2026-10-22T15:00:00Z'), 30);
    expect(new Date('2026-09-23T04:00:00Z') >= start).toBe(true);
    expect(new Date('2026-09-23T03:59:59Z') >= start).toBe(false);
  });
});
