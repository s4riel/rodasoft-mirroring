import { EMPRESA_HEADER, empresaSlugFromHost, isValidEmpresaSlug } from '@rodasoft/domain';

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, unknown>;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Determina qué empresa pide la solicitud, en este orden:
 *   1. Encabezado `X-Empresa` (lo envía el ERP; también útil para Postman/pruebas).
 *   2. Subdominio del Host / X-Forwarded-Host (rodalaser.erp.<dominio>), cuando Caddy o el proxy de Angular lo conservan.
 *   3. `?empresa=` en la query (solo para iniciar el login con Google, que es una navegación del navegador).
 * Esto solo ELIGE la empresa: el acceso real lo decide la membresía del usuario (TenantGuard).
 */
export function resolveEmpresaSlug(req: RequestLike): string | null {
  const header = first(req.headers[EMPRESA_HEADER])?.toLowerCase();
  if (isValidEmpresaSlug(header)) return header;
  const host = first(req.headers['x-forwarded-host']) ?? first(req.headers['host']);
  const fromHost = empresaSlugFromHost(host);
  if (fromHost) return fromHost;
  const q = typeof req.query?.['empresa'] === 'string' ? (req.query['empresa'] as string).toLowerCase() : null;
  return isValidEmpresaSlug(q) ? q : null;
}
