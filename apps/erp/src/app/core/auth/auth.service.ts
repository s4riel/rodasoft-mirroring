import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { SessionResponse, CurrentUser } from '@rodasoft/domain';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ContextStore } from '../context.store';
import { TenantService } from '../tenant.service';

/**
 * ERP session.
 * - The access token lives only in memory (not in localStorage).
 * - The httpOnly refresh cookie is handled by the browser; on reload /auth/refresh is called.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly tenant = inject(TenantService);
  private readonly context = inject(ContextStore);

  private readonly token = signal<string | null>(null);
  readonly user = signal<CurrentUser | null>(null);
  readonly isAuthenticated = computed(() => !!this.token());
  private refreshing: Promise<boolean> | null = null;

  accessToken(): string | null {
    return this.token();
  }

  async login(email: string, password: string): Promise<void> {
    const s = await firstValueFrom(this.http.post<SessionResponse>('/api/v1/auth/login', { email, password }));
    await this.start(s);
  }

  async exchangeGoogleCode(code: string): Promise<void> {
    const s = await firstValueFrom(this.http.post<SessionResponse>('/api/v1/auth/google/exchange', { code }));
    await this.start(s);
  }

  /** Full-page navigation to the API → Google → API → the ERP's /auth/callback. */
  googleLoginUrl(): string {
    return `${environment.apiPublicUrl}/api/v1/auth/google?company=${encodeURIComponent(this.tenant.slug)}`;
  }

  /** Renews the session with the cookie. A single request even if several calls fail at once. */
  refresh(): Promise<boolean> {
    this.refreshing ??= this.postRefresh()
      .then(async (s) => {
        await this.start(s);
        return true;
      })
      .catch(() => {
        this.clear();
        return false;
      })
      .finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  /** 409 CONCURRENT_REFRESH = another tab already renewed the cookie: retry once with the new cookie. */
  private async postRefresh(): Promise<SessionResponse> {
    const call = () => firstValueFrom(this.http.post<SessionResponse>('/api/v1/auth/refresh', {}));
    try {
      return await call();
    } catch (e) {
      if (e instanceof HttpErrorResponse && e.status === 409) {
        await new Promise((r) => setTimeout(r, 300));
        return call();
      }
      throw e;
    }
  }

  async logout(): Promise<void> {
    await firstValueFrom(this.http.post('/api/v1/auth/logout', {})).catch(() => undefined);
    this.clear();
    await this.router.navigate(['/login']);
  }

  requestPasswordReset(email: string) {
    return firstValueFrom(this.http.post<void>('/api/v1/auth/forgot-password', { email }));
  }

  resetPassword(token: string, password: string) {
    return firstValueFrom(this.http.post<void>('/api/v1/auth/reset-password', { token, password }));
  }

  private async start(s: SessionResponse) {
    this.token.set(s.accessToken);
    this.user.set(s.user);
    try {
      await this.context.load();
    } catch (e) {
      this.clear();
      throw e;
    }
  }

  private clear() {
    this.token.set(null);
    this.user.set(null);
    this.context.reset();
  }
}
