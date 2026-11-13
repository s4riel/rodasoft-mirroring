import { siatQrUrl } from './qr-url';
import { EnvironmentCode } from './types';

describe('siatQrUrl', () => {
  it('points at the pilot site in test and at the production site otherwise', () => {
    const test = siatQrUrl({ environment: EnvironmentCode.Test, nit: '1020304050', cuf: 'AB12', number: 7 });
    expect(test).toBe('https://pilotosiat.impuestos.gob.bo/consulta/QR?nit=1020304050&cuf=AB12&numero=7&t=2');
    expect(siatQrUrl({ environment: EnvironmentCode.Production, nit: '1', cuf: 'A', number: 1 })).toContain('https://siat.impuestos.gob.bo/');
  });
});
