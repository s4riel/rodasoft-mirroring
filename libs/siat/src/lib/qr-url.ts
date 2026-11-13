import { EnvironmentCode } from './types';

const BASE = {
  [EnvironmentCode.Production]: 'https://siat.impuestos.gob.bo/consulta/QR',
  [EnvironmentCode.Test]: 'https://pilotosiat.impuestos.gob.bo/consulta/QR',
} as const;

/** The public SIN page that verifies an invoice; it is what the QR of the printed invoice encodes. */
export function siatQrUrl(input: { environment: EnvironmentCode; nit: string; cuf: string; number: number }): string {
  const query = new URLSearchParams({ nit: input.nit, cuf: input.cuf, numero: String(input.number), t: '2' });
  return `${BASE[input.environment]}?${query.toString()}`;
}
