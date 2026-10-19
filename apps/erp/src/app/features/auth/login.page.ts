import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ButtonComponent, FieldComponent, IconComponent, NoteComponent } from '@rodasoft/ui';
import { messageFor, problemOf } from '../../core/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { AuthLayoutComponent } from './auth-layout.component';

/** BC-01 a/b/c/d (normal, error, cargando, Empresa 2), BC-03 (Google), BC-04 (sin acceso), BC-08a (expirada). */
@Component({
  selector: 'rs-login-page',
  imports: [ReactiveFormsModule, RouterLink, AuthLayoutComponent, ButtonComponent, FieldComponent, IconComponent, NoteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <rs-auth-layout>
      <div class="head">
        <h1>Inicia sesión</h1>
        <p class="rs-muted">Usa tu correo de trabajo.</p>
      </div>

      @if (errorMessage(); as msg) {
        <rs-note type="danger">{{ msg }}</rs-note>
      }

      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <rs-field label="Correo" forId="email" [error]="fieldError('email')">
          <input class="rs-input" id="email" type="email" autocomplete="username" formControlName="email"
            placeholder="nombre@rodalaser.com.bo" [attr.aria-invalid]="!!fieldError('email')" />
        </rs-field>

        <rs-field label="Contraseña" forId="password" [error]="fieldError('password')">
          <a rsFieldAction class="link" routerLink="/recuperar">¿Olvidaste tu contraseña?</a>
          <div class="pass">
            <input class="rs-input" id="password" [type]="showPassword() ? 'text' : 'password'" autocomplete="current-password"
              formControlName="password" [attr.aria-invalid]="!!fieldError('password')" />
            <button type="button" class="eye" (click)="showPassword.set(!showPassword())"
              [attr.aria-label]="showPassword() ? 'Ocultar contraseña' : 'Mostrar contraseña'">
              <rs-icon name="eye" [size]="20" />
            </button>
          </div>
        </rs-field>

        <button rsButton type="submit" size="lg" fill [loading]="loading()">Ingresar</button>
      </form>

      <div class="divider"><span>o</span></div>

      <!-- SocialButton Provider=Google. Reemplazar .g-mark por el logo oficial según la guía de marca de Google. -->
      <a rsButton variant="secondary" size="lg" fill [href]="googleUrl">
        <span class="g-mark" aria-hidden="true">G</span>
        Continuar con Google
      </a>
    </rs-auth-layout>
  `,
  styles: `
    .head { display: grid; gap: var(--space-1); margin-bottom: var(--space-6); }
    form { display: grid; gap: var(--space-5); margin-top: var(--space-5); }
    rs-note { margin-bottom: var(--space-2); }
    .link { font-size: var(--text-sm); color: var(--text-muted); }
    .pass { position: relative; }
    .pass .rs-input { padding-right: 48px; }
    .eye {
      position: absolute; right: 6px; top: 50%; transform: translateY(-50%); width: 36px; height: 36px;
      display: grid; place-items: center; border: 0; background: transparent; color: var(--text-muted); border-radius: var(--radius-full); cursor: pointer;
    }
    .divider { display: flex; align-items: center; gap: var(--space-3); margin: var(--space-6) 0; color: var(--text-muted); font-size: var(--text-sm); }
    .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: var(--border-default); }
    .g-mark {
      width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center;
      border: 1px solid var(--border-strong); font-size: 12px; font-weight: 700;
    }
  `,
})
export class LoginPage {
  /** query params (withComponentInputBinding) */
  readonly error = input<string>();
  readonly returnUrl = input<string>();

  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });
  protected readonly loading = signal(false);
  protected readonly showPassword = signal(false);
  protected readonly submitError = signal<string | null>(null);
  protected readonly submitted = signal(false);
  protected readonly googleUrl = this.auth.googleLoginUrl();

  protected readonly errorMessage = computed(() => this.submitError() ?? messageFor(this.error()));

  protected fieldError(name: 'email' | 'password'): string | null {
    const c = this.form.controls[name];
    if (!(c.touched || this.submitted()) || c.valid) return null;
    if (c.hasError('required')) return name === 'email' ? 'Ingresa tu correo' : 'Ingresa tu contraseña';
    if (c.hasError('email')) return 'Correo inválido';
    return null;
  }

  async submit() {
    this.submitted.set(true);
    this.form.markAllAsTouched();
    if (this.form.invalid || this.loading()) return;
    this.loading.set(true);
    this.submitError.set(null);
    try {
      const { email, password } = this.form.getRawValue();
      await this.auth.login(email, password);
      await this.router.navigateByUrl(this.returnUrl() || '/');
    } catch (e) {
      this.submitError.set(problemOf(e).message);
    } finally {
      this.loading.set(false);
    }
  }
}
