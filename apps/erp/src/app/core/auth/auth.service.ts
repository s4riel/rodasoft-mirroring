import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { SesionResponse, UsuarioActual } from '@rodasoft/domain';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ContextStore } from '../context.store';
import { TenantService } from '../tenant.service';

/**
 * Sesión del ERP.
 * - El token de acceso vive solo en memoria (no en localStorage).
 * - La cookie httpOnly de refresh la maneja el navegador; al recargar se llama a /auth/refresh.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly tenant = inject(TenantService);
  private readonly context = inject(ContextStore);

  private readonly token = signal<string | null>(null);
  readonly usuario = signal<UsuarioActual | null>(null);
  readonly isAuthenticated = computed(() => !!this.token());
  private refreshing: Promise<boolean> | null = null;

  accessToken(): string | null {
    return this.token();
  }

  async login(email: string, password: string): Promise<void> {
    const s = await firstValueFrom(this.http.post<SesionResponse>('/api/v1/auth/login', { email, password }));
    await this.start(s);
  }

  async exchangeGoogleCode(code: string): Promise<void> {
    const s = await firstValueFrom(this.http.post<SesionResponse>('/api/v1/auth/google/exchange', { code }));
    await this.start(s);
  }

  /** Navegación completa a la API → Google → API → /auth/callback del ERP. */
  googleLoginUrl(): string {
    return `${environment.apiPublicUrl}/api/v1/auth/google?empresa=${encodeURIComponent(this.tenant.slug)}`;
  }

  /** Renueva la sesión con la cookie. Una sola solicitud aunque varias llamadas fallen a la vez. */
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

  /** 409 REFRESH_CONCURRENTE = otra pestaña ya renovó la cookie: reintentar una vez con la cookie nueva. */
  private async postRefresh(): Promise<SesionResponse> {
    const call = () => firstValueFrom(this.http.post<SesionResponse>('/api/v1/auth/refresh', {}));
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

  solicitarRecuperacion(email: string) {
    return firstValueFrom(this.http.post<void>('/api/v1/auth/recuperar', { email }));
  }

  restablecer(token: string, password: string) {
    return firstValueFrom(this.http.post<void>('/api/v1/auth/restablecer', { token, password }));
  }

  private async start(s: SesionResponse) {
    this.token.set(s.accessToken);
    this.usuario.set(s.usuario);
    try {
      await this.context.load();
    } catch (e) {
      this.clear();
      throw e;
    }
  }

  private clear() {
    this.token.set(null);
    this.usuario.set(null);
    this.context.reset();
  }
}
