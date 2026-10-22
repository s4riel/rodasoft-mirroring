import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonComponent, FieldComponent, NoteComponent } from '@rodasoft/ui';
import { problemOf } from '../../core/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { AuthLayoutComponent } from './auth-layout.component';

@Component({
  selector: 'rs-reset-password-page',
  imports: [ReactiveFormsModule, RouterLink, AuthLayoutComponent, ButtonComponent, FieldComponent, NoteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <rs-auth-layout>
      <div class="head"><h1>Crea una contraseña nueva</h1></div>
      @if (done()) {
        <rs-note type="success" title="Listo">Tu contraseña se cambió. Las demás sesiones se cerraron.</rs-note>
        <a rsButton size="lg" fill routerLink="/login">Iniciar sesión</a>
      } @else {
        @if (error()) {
          <rs-note type="danger">{{ error() }}</rs-note>
        }
        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <rs-field label="Contraseña nueva" forId="password" hint="Mínimo 10 caracteres, con letras y números">
            <input class="rs-input" id="password" type="password" autocomplete="new-password" formControlName="password" />
          </rs-field>
          <button rsButton type="submit" size="lg" fill [loading]="loading()">Guardar contraseña</button>
        </form>
      }
    </rs-auth-layout>
  `,
  styles: `
    .head { margin-bottom: var(--space-6); }
    form, :host rs-note { display: grid; gap: var(--space-5); margin-bottom: var(--space-4); }
  `,
})
export class ResetPasswordPage {
  readonly token = input<string>('');
  private readonly auth = inject(AuthService);
  protected readonly form = inject(NonNullableFormBuilder).group({
    password: ['', [Validators.required, Validators.minLength(10), Validators.pattern(/(?=.*[A-Za-z])(?=.*\d)/)]],
  });
  protected readonly loading = signal(false);
  protected readonly done = signal(false);
  protected readonly error = signal<string | null>(null);

  async submit() {
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.error.set('La contraseña debe tener al menos 10 caracteres, con letras y números.');
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.auth.resetPassword(this.token(), this.form.controls.password.value);
      this.done.set(true);
    } catch (e) {
      this.error.set(problemOf(e).message);
    } finally {
      this.loading.set(false);
    }
  }
}
