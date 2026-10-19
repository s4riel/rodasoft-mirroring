import { base16, buildCuf, cufCadena, formatFechaSiat, formatFechaXml, modulo11 } from './cuf';

describe('CUF', () => {
  // 14/10/2026 10:24:00.000 hora de Bolivia = 14:24 UTC
  const fecha = new Date(Date.UTC(2026, 9, 14, 14, 24, 0, 0));

  it('formatea la fecha en hora de Bolivia', () => {
    expect(formatFechaSiat(fecha)).toBe('20261014102400000');
    expect(formatFechaXml(fecha)).toBe('2026-10-14T10:24:00.000');
  });

  it('calcula módulo 11 con pesos 2..9 desde la derecha', () => {
    // 5·2 + 4·3 + 3·4 + 2·5 + 1·6 = 50 → 50 mod 11 = 6
    expect(modulo11('12345')).toBe('6');
    // resto 10 → "1"
    expect(modulo11('5')).toBe('1');
    // resto 0 → "0"
    expect(modulo11('0')).toBe('0');
  });

  it('convierte a base 16 sin perder precisión', () => {
    const big = '123456789012345678901234567890123456789012345678901234';
    expect(BigInt('0x' + base16(big)).toString()).toBe(big);
    expect(base16('255')).toBe('FF');
  });

  it('arma la cadena de 53 dígitos de la factura 001528 (DEMO)', () => {
    const cadena = cufCadena({
      nit: '1020304059',
      fechaEmision: fecha,
      codigoSucursal: 0,
      codigoModalidad: 1,
      tipoEmision: 1,
      tipoFacturaDocumento: 1,
      tipoDocumentoSector: 1,
      numeroFactura: 1528,
      codigoPuntoVenta: 0,
    });
    expect(cadena).toBe('0001020304059' + '20261014102400000' + '0000' + '1' + '1' + '1' + '01' + '0000001528' + '0000');
    expect(cadena).toHaveLength(53);
  });

  it('agrega verificador, base 16 y código de control', () => {
    const input = {
      nit: '1020304059',
      fechaEmision: fecha,
      codigoSucursal: 0,
      codigoModalidad: 1,
      tipoEmision: 1,
      tipoFacturaDocumento: 1,
      tipoDocumentoSector: 1,
      numeroFactura: 1528,
      codigoPuntoVenta: 0,
      codigoControl: 'A19E23EF34124CD',
    };
    const cuf = buildCuf(input);
    const hex = cuf.slice(0, -input.codigoControl.length);
    const decimal = BigInt('0x' + hex).toString().padStart(54, '0');
    expect(decimal.slice(0, 53)).toBe(cufCadena(input));
    expect(decimal.slice(53)).toBe(modulo11(cufCadena(input)));
    expect(cuf.endsWith('A19E23EF34124CD')).toBe(true);
    expect(cuf).toMatch(/^[0-9A-F]+$/);
  });

  it('rechaza valores que no caben', () => {
    expect(() =>
      buildCuf({
        nit: '12345678901234',
        fechaEmision: fecha,
        codigoSucursal: 0,
        codigoModalidad: 1,
        tipoEmision: 1,
        tipoFacturaDocumento: 1,
        tipoDocumentoSector: 1,
        numeroFactura: 1,
        codigoPuntoVenta: 0,
        codigoControl: 'X',
      }),
    ).toThrow('excede 13');
  });

  it.todo('coincide con el ejemplo oficial del documento técnico del SIN');
});
