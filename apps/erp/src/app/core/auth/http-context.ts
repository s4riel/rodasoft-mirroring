import { HttpContext, HttpContextToken } from '@angular/common/http';

/** Solicitudes que NO deben disparar un refresco ante 401 (las que ocurren dentro del propio refresco/login). */
export const SKIP_AUTH_RETRY = new HttpContextToken<boolean>(() => false);

export const skipAuthRetry = () => new HttpContext().set(SKIP_AUTH_RETRY, true);
