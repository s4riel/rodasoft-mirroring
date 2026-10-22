import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonComponent, FieldComponent, NoteComponent } from '@rodasoft/ui';
import { problemOf } from '../../core/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { AuthLayoutComponent } from './auth-layout.component';

/** BC-02a (ask for email) and BC-02b (link sent). */
@Component({
  selector: 'rs-forgot-password-page',
  imports: [ReactiveFormsModule, RouterLink, AuthLayoutComponent, ButtonComponent, FieldComponent, NoteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <rs-auth-layout>
      @if (!sent()) {
        <div class="head">
          <h1>Recupera tu contraseña</h1>
          <p class="rs-muted">Te enviaremos un enlace para crear una nueva. Vence en 30 minutos.</p>
        </div>
        @if (error()) {
          <rs-note type="danger">{{ error() }}</rs-note>
        }
        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <rs-field label="Correo" forId="email" [error]="form.controls.email.touched && form.controls.email.invalid ? 'Ingresa un correo válido' : null">
            <input class="rs-input" id="email" type="email" autocomplete="email" formControlName="email" />
          </rs-field>
          <button rsButton type="submit" size="lg" fill [loading]="loading()">Enviar enlace</button>
        </form>
      } @else {
        <div class="head">
          <h1>Revisa tu correo</h1>
          <p class="rs-muted">
            Si <strong>{{ form.controls.email.value }}</strong> tiene una cuenta, te llegará un enlace en unos minutos.
          </p>
        </div>
      }
      <a class="back" routerLink="/login">← Volver a iniciar sesión</a>
    </rs-auth-layout>
  `,
  styles: `
    .head { display: grid; gap: var(--space-2); margin-bottom: var(--space-6); }
    form { display: grid; gap: var(--space-5); margin-top: var(--space-4); }
    .back { display: inline-block; margin-top: var(--space-6); color: var(--text-muted); }
  `,
})
export class ForgotPasswordPage {
  private readonly auth = inject(AuthService);
  protected readonly form = inject(NonNullableFormBuilder).group({ email: ['', [Validators.required, Validators.email]] });
  protected readonly loading = signal(false);
  protected readonly sent = signal(false);
  protected readonly error = signal<string | null>(null);

  async submit() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.auth.requestPasswordReset(this.form.controls.email.value);
      this.sent.set(true);
    } catch (e) {
      this.error.set(problemOf(e).message);
    } finally {
      this.loading.set(false);
    }
  }
}
