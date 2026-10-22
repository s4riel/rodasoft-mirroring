import { base16, buildCuf, cufChain, formatSiatDate, formatXmlDate, modulo11 } from './cuf';

describe('CUF', () => {
  // 14/10/2026 10:24:00.000 Bolivia time = 14:24 UTC
  const date = new Date(Date.UTC(2026, 9, 14, 14, 24, 0, 0));

  it('formats the date in Bolivia time', () => {
    expect(formatSiatDate(date)).toBe('20261014102400000');
    expect(formatXmlDate(date)).toBe('2026-10-14T10:24:00.000');
  });

  it('computes modulo 11 with weights 2..9 from the right', () => {
    // 5·2 + 4·3 + 3·4 + 2·5 + 1·6 = 50 → 50 mod 11 = 6
    expect(modulo11('12345')).toBe('6');
    // remainder 10 -> "1"
    expect(modulo11('5')).toBe('1');
    // remainder 0 -> "0"
    expect(modulo11('0')).toBe('0');
  });

  it('converts to base 16 without losing precision', () => {
    const big = '123456789012345678901234567890123456789012345678901234';
    expect(BigInt('0x' + base16(big)).toString()).toBe(big);
    expect(base16('255')).toBe('FF');
  });

  it('builds the 53-digit chain for demo invoice 001528', () => {
    const chain = cufChain({
      nit: '1020304059',
      issuedAt: date,
      branchCode: 0,
      modalityCode: 1,
      emissionType: 1,
      invoiceDocumentType: 1,
      sectorDocumentType: 1,
      invoiceNumber: 1528,
      pointOfSaleCode: 0,
    });
    expect(chain).toBe('0001020304059' + '20261014102400000' + '0000' + '1' + '1' + '1' + '01' + '0000001528' + '0000');
    expect(chain).toHaveLength(53);
  });

  it('appends check digit, base 16 and control code', () => {
    const input = {
      nit: '1020304059',
      issuedAt: date,
      branchCode: 0,
      modalityCode: 1,
      emissionType: 1,
      invoiceDocumentType: 1,
      sectorDocumentType: 1,
      invoiceNumber: 1528,
      pointOfSaleCode: 0,
      controlCode: 'A19E23EF34124CD',
    };
    const cuf = buildCuf(input);
    const hex = cuf.slice(0, -input.controlCode.length);
    const decimal = BigInt('0x' + hex).toString().padStart(54, '0');
    expect(decimal.slice(0, 53)).toBe(cufChain(input));
    expect(decimal.slice(53)).toBe(modulo11(cufChain(input)));
    expect(cuf.endsWith('A19E23EF34124CD')).toBe(true);
    expect(cuf).toMatch(/^[0-9A-F]+$/);
  });

  it('rejects values that do not fit', () => {
    expect(() =>
      buildCuf({
        nit: '12345678901234',
        issuedAt: date,
        branchCode: 0,
        modalityCode: 1,
        emissionType: 1,
        invoiceDocumentType: 1,
        sectorDocumentType: 1,
        invoiceNumber: 1,
        pointOfSaleCode: 0,
        controlCode: 'X',
      }),
    ).toThrow('exceeds 13');
  });

  it.todo('matches the official example in the SIN technical document');
});
