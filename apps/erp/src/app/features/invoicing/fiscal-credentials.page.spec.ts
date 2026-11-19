import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { FiscalSettingsSummary } from '@rodasoft/domain';
import { FiscalCredentialsPage } from './fiscal-credentials.page';

const SETTINGS = '/api/v1/invoicing/fiscal-settings';

const summary = (over: Partial<FiscalSettingsSummary> = {}): FiscalSettingsSummary =>
  ({
    environment: 'TEST',
    modality: 'ELECTRONIC_ONLINE',
    gateway: 'SIMULATED',
    productionEnabledAt: null,
    warnDays: 30,
    connection: { status: 'UNKNOWN', checkedAt: null },
    signature: { present: false, fileName: null, holder: null, uploadedAt: null, expiresAt: null, health: 'OK' },
    credentials: { systemCode: null, tokenPresent: false, tokenExpiresAt: null, tokenHealth: 'OK' },
    activity: { mainActivityCode: null, defaultProductCode: null },
    pointsOfSale: { total: 0, active: 0, withCuis: 0 },
    catalogs: { synced: false, syncedAt: null },
    homologation: { total: 0, done: 0, pending: 0, percent: 0 },
    checklist: [],
    production: { ready: false, requirements: [] },
    ...over,
  }) as FiscalSettingsSummary;

describe('FiscalCredentialsPage (FS-31)', () => {
  let http: HttpTestingController;

  async function open() {
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: 'invoicing/settings/credentials', component: FiscalCredentialsPage }]), provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/invoicing/settings/credentials', FiscalCredentialsPage);
    return harness;
  }
  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  async function settle(h: RouterTestingHarness) {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }
  const fill = (h: RouterTestingHarness, selector: string, value: string) => {
    const input = root(h).querySelector<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    h.detectChanges();
  };

  afterEach(() => http.verify());

  it('says which signature and token are stored, without showing any secret', async () => {
    const h = await open();
    http.expectOne(SETTINGS).flush(
      summary({
        signature: { present: true, fileName: 'firma.p12', holder: 'Rodalaser SRL', uploadedAt: '2026-11-01T14:00:00.000Z', expiresAt: '2027-11-01T14:00:00.000Z', health: 'OK' },
        credentials: { systemCode: 'SYS1', tokenPresent: true, tokenExpiresAt: '2027-05-01T14:00:00.000Z', tokenHealth: 'OK' },
      }),
    );
    await settle(h);
    expect(root(h).querySelector('[data-testid="signature-current"]')?.textContent).toContain('Rodalaser SRL');
    expect(root(h).querySelector('[data-testid="token-current"]')?.textContent).toContain('Token guardado');
    expect(root(h).querySelector<HTMLInputElement>('#system-code')?.value).toBe('SYS1');
    expect(root(h).querySelector<HTMLInputElement>('#token')?.value).toBe('');
  });

  it('warns before the signature or the token expire', async () => {
    const h = await open();
    http.expectOne(SETTINGS).flush(
      summary({
        signature: { present: true, fileName: 'f.p12', holder: 'X', uploadedAt: null, expiresAt: '2026-12-01T14:00:00.000Z', health: 'EXPIRING' },
        credentials: { systemCode: 'S', tokenPresent: true, tokenExpiresAt: '2026-11-01T14:00:00.000Z', tokenHealth: 'EXPIRED' },
      }),
    );
    await settle(h);
    const notes = Array.from(root(h).querySelectorAll('[data-testid="expiry-warning"]')).map((n) => n.textContent ?? '');
    expect(notes[0]).toContain('vence en menos de 30 días');
    expect(notes[1]).toContain('está vencido');
  });

  it('asks for the three credential fields and saves them, then reloads', async () => {
    const h = await open();
    http.expectOne(SETTINGS).flush(summary());
    await settle(h);
    root(h).querySelector<HTMLButtonElement>('[data-testid="credentials-save"]')?.click();
    await settle(h);
    expect(root(h).textContent).toContain('Escribe el código de sistema.');
    expect(root(h).textContent).toContain('Pega el token delegado del SIAT.');
    fill(h, '#system-code', 'SYS9');
    fill(h, '#token', 'tok-xyz');
    fill(h, '#token-expires', '2027-05-01');
    root(h).querySelector<HTMLButtonElement>('[data-testid="credentials-save"]')?.click();
    const save = http.expectOne((r) => r.method === 'PUT' && r.url === `${SETTINGS}/credentials`);
    expect(save.request.body).toMatchObject({ systemCode: 'SYS9', token: 'tok-xyz' });
    expect(save.request.body.tokenExpiresAt).toMatch(/^2027-05-0[12]T/);
    save.flush({ systemCode: 'SYS9', tokenPresent: true, tokenExpiresAt: '2027-05-02T03:59:59.000Z', tokenHealth: 'OK' });
    await settle(h);
    http.expectOne(SETTINGS).flush(summary());
    await settle(h);
    expect(root(h).querySelector<HTMLInputElement>('#token')?.value).toBe('');
  });

  it('uploads the .p12 with its password and shows why the API refused a bad one', async () => {
    const h = await open();
    http.expectOne(SETTINGS).flush(summary());
    await settle(h);
    const page = h.routeDebugElement!.componentInstance as { pick(files: File[]): void };
    page.pick([new File(['x'], 'firma.p12')]);
    fill(h, '#signature-password', 'clave');
    root(h).querySelector<HTMLButtonElement>('[data-testid="signature-save"]')?.click();
    const upload = http.expectOne((r) => r.method === 'PUT' && r.url === `${SETTINGS}/signature`);
    expect((upload.request.body as FormData).get('password')).toBe('clave');
    expect((upload.request.body as FormData).get('file')).toBeInstanceOf(File);
    upload.flush({ code: 'SIGNATURE_INVALID', message: 'x' }, { status: 400, statusText: 'Bad Request' });
    await settle(h);
    expect(root(h).textContent).toContain('El archivo .p12 o su contraseña no son válidos.');
  });

  it('tests the connection and reloads the state', async () => {
    const h = await open();
    http.expectOne(SETTINGS).flush(summary());
    await settle(h);
    root(h).querySelector<HTMLButtonElement>('[data-testid="test-connection"]')?.click();
    http.expectOne('/api/v1/invoicing/test-connection').flush({ connection: 'ONLINE', checkedAt: '2026-11-16T14:00:00.000Z' });
    await settle(h);
    http.expectOne(SETTINGS).flush(summary());
  });

  it('shows the error and no-permission states', async () => {
    const h = await open();
    http.expectOne(SETTINGS).flush({ code: 'FORBIDDEN', message: 'no' }, { status: 403, statusText: 'Forbidden' });
    await settle(h);
    expect(root(h).textContent).toContain('No tienes permiso para ver las credenciales');
  });
});
