/**
 * Multiempresa: la empresa activa la define la URL (subdominio), nunca un selector en pantalla.
 *   rodalaser.erp.<dominio>  → empresa "rodalaser"
 *   empresa2.erp.<dominio>   → empresa "empresa2"
 * En desarrollo: http://rodalaser.localhost:4200 y http://empresa2.localhost:4200
 */
export const EMPRESA_HEADER = 'x-empresa';

export type BrandMode = 'rodalaser' | 'empresa2';

export interface EmpresaContexto {
  id: string;
  slug: string;
  razonSocial: string;
  nombreComercial: string;
  nit: string;
  brand: BrandMode;
}

export interface SucursalContexto {
  id: string;
  codigo: number;
  nombre: string;
  almacenes: { id: string; codigo: string; nombre: string }[];
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

export function isValidEmpresaSlug(slug: string | null | undefined): slug is string {
  return !!slug && SLUG_RE.test(slug);
}

/**
 * Obtiene el slug de empresa desde el host.
 * `rodalaser.erp.rodalaser.com.bo` → `rodalaser`; `empresa2.localhost` → `empresa2`.
 * Devuelve null para hosts sin subdominio de empresa (localhost, IPs, `www`).
 */
export function empresaSlugFromHost(host: string | null | undefined, reserved: string[] = ['www', 'api', 'erp']): string | null {
  if (!host) return null;
  const hostname = host.split(':')[0].toLowerCase();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname === 'localhost') return null;
  const first = hostname.split('.')[0];
  if (reserved.includes(first)) return null;
  return isValidEmpresaSlug(first) ? first : null;
}
