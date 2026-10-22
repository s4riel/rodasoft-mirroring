import { ttlToSeconds } from './tokens.service';

describe('ttlToSeconds', () => {
  it.each([
    ['15m', 900],
    ['30s', 30],
    ['2h', 7200],
    ['7d', 604800],
    ['45', 45],
  ])('%s → %d', (ttl, s) => expect(ttlToSeconds(ttl as string)).toBe(s));

  it('rejects invalid formats', () => expect(() => ttlToSeconds('fifteen')).toThrow());
});
