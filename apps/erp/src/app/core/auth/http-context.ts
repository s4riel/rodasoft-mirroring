import { HttpContext, HttpContextToken } from '@angular/common/http';

/** Requests that must NOT trigger a refresh on 401 (those made inside the refresh/login itself). */
export const SKIP_AUTH_RETRY = new HttpContextToken<boolean>(() => false);

export const skipAuthRetry = () => new HttpContext().set(SKIP_AUTH_RETRY, true);
