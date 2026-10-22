import type { ClsStore } from 'nestjs-cls';

/** Per-request context (AsyncLocalStorage). Filled by the CLS middleware and TenantGuard. */
export interface AppClsStore extends ClsStore {
  /** slug requested via URL/header (before authenticating) */
  companySlug: string | null;
  /** company already validated against the user's membership */
  companyId: string | null;
  userId: string | null;
  membershipId: string | null;
  ip: string | null;
  userAgent: string | null;
}
