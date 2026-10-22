/**
 * Multi-company: the active company is defined by the URL (subdomain), never by an on-screen selector.
 *   rodalaser.erp.<domain>  -> company "rodalaser"
 *   company2.erp.<domain>   -> company "company2"
 * In development: http://rodalaser.localhost:4200 and http://company2.localhost:4200
 */
export const COMPANY_HEADER = 'x-company';

export type BrandMode = 'rodalaser' | 'company2';

export interface CompanyContext {
  id: string;
  slug: string;
  legalName: string;
  tradeName: string;
  nit: string;
  brand: BrandMode;
}

export interface BranchContext {
  id: string;
  /** SIN branch code (0 = head office) */
  code: number;
  name: string;
  warehouses: { id: string; code: string; name: string }[];
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

export function isValidCompanySlug(slug: string | null | undefined): slug is string {
  return !!slug && SLUG_RE.test(slug);
}

/**
 * Extracts the company slug from the host.
 * `rodalaser.erp.rodalaser.com.bo` -> `rodalaser`; `company2.localhost` -> `company2`.
 * Returns null for hosts without a company subdomain (localhost, IPs, `www`).
 */
export function companySlugFromHost(host: string | null | undefined, reserved: string[] = ['www', 'api', 'erp']): string | null {
  if (!host) return null;
  const hostname = host.split(':')[0].toLowerCase();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname === 'localhost') return null;
  const first = hostname.split('.')[0];
  if (reserved.includes(first)) return null;
  return isValidCompanySlug(first) ? first : null;
}
