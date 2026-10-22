import type { CookieOptions, Response } from 'express';
import type { Env } from '../../config/env';

export const REFRESH_COOKIE = 'rs_refresh';
export const GOOGLE_STATE_COOKIE = 'rs_gstate';

/** The refresh cookie only travels to /api/v1/auth and is never readable from JavaScript. */
export function refreshCookieOptions(env: Pick<Env, 'COOKIE_SECURE'>, maxAgeMs?: number): CookieOptions {
  // Without `domain`: the cookie stays on the ERP host (rodalaser.localhost / rodalaser.erp.<domain>),
  // so each company has its own session.
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/api/v1/auth',
    maxAge: maxAgeMs,
  };
}

export function clearRefreshCookie(res: Response, env: Pick<Env, 'COOKIE_SECURE'>) {
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(env), maxAge: undefined });
}
