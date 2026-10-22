import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { COMPANY_HEADER } from '@rodasoft/domain';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { SKIP_AUTH_RETRY } from './http-context';
import { TenantService } from '../tenant.service';
import { AuthService } from './auth.service';

const isApi = (req: HttpRequest<unknown>) => req.url.startsWith('/api/');
const isAuthEndpoint = (req: HttpRequest<unknown>) => req.url.startsWith('/api/v1/auth/');

/** Adds the company and token; on a 401 it renews the session once and retries. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isApi(req)) return next(req);
  const auth = inject(AuthService);
  const tenant = inject(TenantService);
  const router = inject(Router);

  const withHeaders = (r: HttpRequest<unknown>) => {
    const token = auth.accessToken();
    return r.clone({
      setHeaders: { [COMPANY_HEADER]: tenant.slug, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  };

  return next(withHeaders(req)).pipe(
    catchError((err: unknown) => {
      if (
        !(err instanceof HttpErrorResponse) ||
        err.status !== 401 ||
        isAuthEndpoint(req) ||
        req.context.get(SKIP_AUTH_RETRY)
      ) {
        return throwError(() => err);
      }
      return from(auth.refresh()).pipe(
        switchMap((ok) => {
          if (ok) return next(withHeaders(req));
          void router.navigate(['/login'], { queryParams: { error: 'INVALID_SESSION', returnUrl: router.url } });
          return throwError(() => err);
        }),
      );
    }),
  );
};
