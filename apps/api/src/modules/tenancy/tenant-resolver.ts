import { COMPANY_HEADER, companySlugFromHost, isValidCompanySlug } from '@rodasoft/domain';

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, unknown>;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Determines which company the request is asking for, in this order:
 *   1. `X-Company` header (sent by the ERP; also handy for Postman/tests).
 *   2. Host / X-Forwarded-Host subdomain (rodalaser.erp.<domain>), when Caddy or the Angular proxy preserves it.
 *   3. `?company=` in the query (only to start the Google login, which is a browser navigation).
 * This only PICKS the company: real access is decided by the user's membership (TenantGuard).
 */
export function resolveCompanySlug(req: RequestLike): string | null {
  const header = first(req.headers[COMPANY_HEADER])?.toLowerCase();
  if (isValidCompanySlug(header)) return header;
  const host = first(req.headers['x-forwarded-host']) ?? first(req.headers['host']);
  const fromHost = companySlugFromHost(host);
  if (fromHost) return fromHost;
  const q = typeof req.query?.['company'] === 'string' ? (req.query['company'] as string).toLowerCase() : null;
  return isValidCompanySlug(q) ? q : null;
}
