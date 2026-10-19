import { isNitFormatValid, normalizeNit } from './nit';

describe('NIT', () => {
  it('normaliza y valida el formato', () => {
    expect(normalizeNit('1020 304-078')).toBe('1020304078');
    expect(isNitFormatValid('1020304078')).toBe(true);
    expect(isNitFormatValid('12a45')).toBe(false);
    expect(isNitFormatValid('0000000')).toBe(false);
    expect(isNitFormatValid('123')).toBe(false);
  });
});
