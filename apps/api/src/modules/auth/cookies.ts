import type { CookieOptions, Response } from 'express';
import type { Env } from '../../config/env';

export const REFRESH_COOKIE = 'rs_refresh';
export const GOOGLE_STATE_COOKIE = 'rs_gstate';

/** La cookie de refresh solo viaja a /api/v1/auth y nunca es legible desde JavaScript. */
export function refreshCookieOptions(env: Pick<Env, 'COOKIE_SECURE'>, maxAgeMs?: number): CookieOptions {
  // Sin `domain`: la cookie queda en el host del ERP (rodalaser.localhost / rodalaser.erp.<dominio>),
  // así cada empresa tiene su propia sesión.
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
