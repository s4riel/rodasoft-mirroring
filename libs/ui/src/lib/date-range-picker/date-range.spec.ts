import { addDays, formatDay, formatRange, monthGrid, parseIso, pickDay, presetRange } from './date-range';

describe('date-range', () => {
  it('rejects days that do not exist', () => {
    expect(parseIso('2023-10-13')).toEqual([2023, 9, 13]);
    expect(parseIso('2023-02-30')).toBeNull();
    expect(parseIso('13/10/2023')).toBeNull();
    expect(parseIso(null)).toBeNull();
  });

  it('adds days across months and years', () => {
    expect(addDays('2023-12-31', 1)).toBe('2024-01-01');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
  });

  it('lays October 2023 out Monday first, with the grey days of September', () => {
    const weeks = monthGrid(2023, 9);
    expect(weeks[0][0]).toEqual({ iso: '2023-09-25', day: 25, inMonth: false });
    expect(weeks[0][6]).toEqual({ iso: '2023-10-01', day: 1, inMonth: true });
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks.flat().filter((d) => d.inMonth)).toHaveLength(31);
  });

  it('gives the last calendar week, month and year', () => {
    // 2023-10-13 is a Friday, as in the Figma reference
    expect(presetRange('last-week', '2023-10-13')).toEqual({ from: '2023-10-02', to: '2023-10-08' });
    expect(presetRange('last-week', '2023-10-15')).toEqual({ from: '2023-10-02', to: '2023-10-08' });
    expect(presetRange('last-month', '2023-10-13')).toEqual({ from: '2023-09-01', to: '2023-09-30' });
    expect(presetRange('last-month', '2024-01-10')).toEqual({ from: '2023-12-01', to: '2023-12-31' });
    expect(presetRange('last-year', '2023-10-13')).toEqual({ from: '2022-01-01', to: '2022-12-31' });
  });

  it('builds the range with two clicks and starts again on the third', () => {
    const first = pickDay({ from: null, to: null }, '2023-10-10');
    expect(first).toEqual({ from: '2023-10-10', to: null });
    expect(pickDay(first, '2023-10-14')).toEqual({ from: '2023-10-10', to: '2023-10-14' });
    expect(pickDay(first, '2023-10-03')).toEqual({ from: '2023-10-03', to: '2023-10-10' });
    expect(pickDay({ from: '2023-10-10', to: '2023-10-14' }, '2023-10-20')).toEqual({ from: '2023-10-20', to: null });
  });

  it('formats days and ranges in Spanish order', () => {
    expect(formatDay('2023-10-02')).toBe('02/10/2023');
    expect(formatRange({ from: '2023-10-02', to: '2023-10-08' })).toBe('02/10/2023 – 08/10/2023');
    expect(formatRange({ from: '2023-10-02', to: null })).toBe('Desde 02/10/2023');
    expect(formatRange({ from: null, to: null })).toBe('');
  });
});
