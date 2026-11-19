import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { FiscalSettingsSummary } from '@rodasoft/domain';
import {
  ButtonComponent,
  EmptyStateIllustratedComponent,
  FieldComponent,
  FileDropzoneComponent,
  FileItemComponent,
  InputDirective,
  NoteComponent,
  PageHeaderComponent,
  SkeletonComponent,
  ToastOutletComponent,
  ToastService,
} from '@rodasoft/ui';
import { problemOf } from '../../core/api-error';
import { formatDateTime } from '../sales/cash/cash-format';
import { fileSizeLabel } from './fiscal-format';
import { InvoicingApi } from './invoicing-api.service';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

/**
 * FS-31 · Credentials and digital signature (HU-FAC-22, HU-FAC-23): the `.p12` certificate with its password, the system code and the
 * delegated token with their expiry, and the connection test. Secrets go to the API and are never shown again: the page only says
 * that they are stored and until when they are valid.
 */
@Component({
  selector: 'rs-fiscal-credentials-page',
  imports: [
    ButtonComponent,
    EmptyStateIllustratedComponent,
    FieldComponent,
    FileDropzoneComponent,
    FileItemComponent,
    InputDirective,
    NoteComponent,
    PageHeaderComponent,
    SkeletonComponent,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './fiscal-credentials.page.html',
  styleUrl: './fiscal-credentials.page.scss',
})
export class FiscalCredentialsPage {
  private readonly api = inject(InvoicingApi);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly breadcrumbs = [
    { label: 'Inicio', link: '/' },
    { label: 'Facturación SIAT' },
    { label: 'Configuración fiscal', link: '/invoicing/settings' },
    { label: 'Credenciales' },
  ];
  protected readonly fileSizeLabel = fileSizeLabel;
  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly data = signal<FiscalSettingsSummary | null>(null);

  // signature
  protected readonly file = signal<File | null>(null);
  protected readonly password = signal('');
  protected readonly signatureError = signal<string | null>(null);
  protected readonly savingSignature = signal(false);

  // credentials
  protected readonly systemCode = signal('');
  protected readonly token = signal('');
  protected readonly tokenExpires = signal('');
  protected readonly touched = signal(false);
  protected readonly credentialsError = signal<string | null>(null);
  protected readonly savingCredentials = signal(false);
  protected readonly testing = signal(false);

  protected readonly canSaveSignature = computed(() => this.file() !== null && this.password() !== '' && !this.savingSignature());
  protected readonly systemCodeError = computed(() => (this.touched() && this.systemCode().trim() === '' ? 'Escribe el código de sistema.' : null));
  protected readonly tokenError = computed(() => (this.touched() && this.token().trim() === '' ? 'Pega el token delegado del SIAT.' : null));
  protected readonly expiryError = computed(() => (this.touched() && this.tokenExpires() === '' ? 'Elige la fecha de vencimiento del token.' : null));
  protected readonly signatureText = computed(() => {
    const s = this.data()?.signature;
    if (!s?.present) return null;
    return `${s.holder ?? 'Titular sin nombre'} · vence el ${s.expiresAt ? formatDateTime(s.expiresAt).slice(0, 10) : '—'}`;
  });
  protected readonly tokenText = computed(() => {
    const c = this.data()?.credentials;
    return c?.tokenPresent && c.tokenExpiresAt ? `Token guardado · vence el ${formatDateTime(c.tokenExpiresAt).slice(0, 10)}` : null;
  });
  protected readonly warnings = computed(() => {
    const d = this.data();
    if (!d) return [];
    const out: string[] = [];
    if (d.signature.present && d.signature.health !== 'OK') out.push(`La firma digital ${d.signature.health === 'EXPIRED' ? 'está vencida' : `vence en menos de ${d.warnDays} días`}.`);
    if (d.credentials.tokenPresent && d.credentials.tokenHealth !== 'OK') out.push(`El token del SIAT ${d.credentials.tokenHealth === 'EXPIRED' ? 'está vencido' : `vence en menos de ${d.warnDays} días`}.`);
    return out;
  });

  constructor() {
    this.load();
  }

  protected load() {
    this.state.set('loading');
    this.api
      .fiscalSettings()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.data.set(data);
          this.systemCode.set(data.credentials.systemCode ?? '');
          this.state.set('ready');
        },
        error: (err) => {
          const problem = problemOf(err);
          this.errorMessage.set(problem.message);
          this.state.set(problem.status === 403 ? 'forbidden' : 'error');
        },
      });
  }

  protected pick(files: File[]) {
    this.file.set(files[0] ?? null);
    this.signatureError.set(null);
  }

  protected saveSignature() {
    const file = this.file();
    if (!file || !this.canSaveSignature()) return;
    this.savingSignature.set(true);
    this.signatureError.set(null);
    this.api
      .saveSignature(file, this.password())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.savingSignature.set(false);
          this.file.set(null);
          this.password.set('');
          this.toast.success('Firma digital guardada');
          this.load();
        },
        error: (err) => {
          this.savingSignature.set(false);
          this.signatureError.set(problemOf(err).message);
        },
      });
  }

  protected saveCredentials() {
    this.touched.set(true);
    if (this.systemCode().trim() === '' || this.token().trim() === '' || this.tokenExpires() === '' || this.savingCredentials()) return;
    this.savingCredentials.set(true);
    this.credentialsError.set(null);
    this.api
      .saveCredentials({ systemCode: this.systemCode().trim(), token: this.token().trim(), tokenExpiresAt: new Date(`${this.tokenExpires()}T23:59:59-04:00`).toISOString() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.savingCredentials.set(false);
          this.token.set('');
          this.tokenExpires.set('');
          this.touched.set(false);
          this.toast.success('Credenciales guardadas');
          this.load();
        },
        error: (err) => {
          this.savingCredentials.set(false);
          this.credentialsError.set(problemOf(err).message);
        },
      });
  }

  protected testConnection() {
    if (this.testing()) return;
    this.testing.set(true);
    this.api
      .testConnection()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.testing.set(false);
          this.toast.success('Conexión con el SIAT correcta');
          this.load();
        },
        error: (err) => {
          this.testing.set(false);
          this.toast.danger(problemOf(err).message);
          this.load();
        },
      });
  }
}
