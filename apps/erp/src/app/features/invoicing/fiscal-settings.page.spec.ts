import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { FiscalSettingsSummary } from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { FiscalSettingsPage } from './fiscal-settings.page';

const URL = '/api/v1/invoicing/fiscal-settings';

const summary = (over: Partial<FiscalSettingsSummary> = {}): FiscalSettingsSummary => ({
  environment: 'TEST',
  modality: 'ELECTRONIC_ONLINE',
  gateway: 'SIMULATED',
  productionEnabledAt: null,
  warnDays: 30,
  connection: { status: 'ONLINE', checkedAt: '2026-11-16T14:00:00.000Z' },
  signature: { present: true, fileName: 'firma.p12', holder: 'Rodalaser SRL', uploadedAt: '2026-11-01T14:00:00.000Z', expiresAt: '2027-11-01T14:00:00.000Z', health: 'OK' },
  credentials: { systemCode: 'SYS1', tokenPresent: true, tokenExpiresAt: '2027-05-01T14:00:00.000Z', tokenHealth: 'OK' },
  activity: { mainActivityCode: '465900', defaultProductCode: null },
  pointsOfSale: { total: 2, active: 2, withCuis: 2 },
  catalogs: { synced: true, syncedAt: '2026-11-16T14:00:00.000Z' },
  homologation: { total: 10, done: 8, pending: 2, percent: 80 },
  checklist: [
    { key: 'SIGNATURE', status: 'OK', detail: '2027-11-01T14:00:00.000Z' },
    { key: 'CREDENTIALS', status: 'OK', detail: '2027-05-01T14:00:00.000Z' },
    { key: 'CONNECTION', status: 'OK', detail: '2026-11-16T14:00:00.000Z' },
    { key: 'POINTS_OF_SALE', status: 'OK', detail: '2' },
    { key: 'CATALOGS', status: 'OK', detail: '2026-11-16T14:00:00.000Z' },
    { key: 'ACTIVITY', status: 'OK', detail: '465900' },
    { key: 'HOMOLOGATION', status: 'WARNING', detail: '8/10' },
  ],
  production: { ready: false, requirements: ['PRODUCTS_NOT_HOMOLOGATED'] },
  ...over,
});

describe('FiscalSettingsPage (FS-07)', () => {
  let http: HttpTestingController;

  async function open(permissions: string[] = ['invoicing.settings.manage', 'invoicing.production.enable']) {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'invoicing/settings', component: FiscalSettingsPage }]), provideHttpClient(), provideHttpClientTesting(), { provide: RS_PERMISSIONS, useValue: signal(new Set(permissions)) }],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/invoicing/settings', FiscalSettingsPage);
    return harness;
  }
  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  async function settle(h: RouterTestingHarness) {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }

  afterEach(() => http.verify());

  it('shows the status of every section, each linking to its page', async () => {
    const h = await open();
    http.expectOne(URL).flush(summary());
    await settle(h);
    const text = root(h).textContent ?? '';
    expect(text).toContain('Firma digital');
    expect(text).toContain('Homologación de productos');
    expect(text).toContain('Revisar');
    expect(root(h).querySelector('[data-testid="section-SIGNATURE"]')?.getAttribute('href')).toBe('/invoicing/settings/credentials');
    expect(root(h).querySelector('[data-testid="section-POINTS_OF_SALE"]')?.getAttribute('href')).toBe('/invoicing/settings/points-of-sale');
    expect(root(h).querySelector('[data-testid="section-CATALOGS"]')?.getAttribute('href')).toBe('/invoicing/settings/catalogs');
    expect(root(h).querySelector('[data-testid="section-HOMOLOGATION"]')?.getAttribute('href')).toBe('/invoicing/settings/homologation');
    expect(root(h).querySelector('[data-testid="test-note"]')).not.toBeNull();
  });

  it('warns when the signature or the token is about to expire', async () => {
    const h = await open();
    http.expectOne(URL).flush(summary({ signature: { ...summary().signature, health: 'EXPIRING' }, credentials: { ...summary().credentials, tokenHealth: 'EXPIRED' } }));
    await settle(h);
    const notes = Array.from(root(h).querySelectorAll('[data-testid="expiry-note"]')).map((n) => n.textContent);
    expect(notes[0]).toContain('La firma digital está por vencer');
    expect(notes[1]).toContain('El token del SIAT está vencido');
  });

  it('offers "Pasar a producción" only with the permission, and not once in production', async () => {
    const h = await open(['invoicing.settings.manage']);
    http.expectOne(URL).flush(summary());
    await settle(h);
    expect(root(h).querySelector('[data-testid="production-open"]')).toBeNull();
  });

  it('keeps "Pasar a producción" disabled and says what is missing while something is', async () => {
    const h = await open();
    http.expectOne(URL).flush(summary());
    await settle(h);
    expect(root(h).querySelector<HTMLButtonElement>('[data-testid="production-open"]')?.disabled).toBe(true);
    expect(root(h).querySelector('[data-testid="test-note"]')?.textContent).toContain('No se puede pasar a producción todavía');
    expect(root(h).querySelector('[data-testid="test-note"]')?.textContent).toContain('Hay productos sin código SIN');
  });

  it('opens the production dialog asking to type the word when everything is ready', async () => {
    const h = await open();
    http.expectOne(URL).flush(summary({ production: { ready: true, requirements: [] } }));
    await settle(h);
    expect(root(h).querySelector('[data-testid="test-note"]')?.textContent).toContain('Todo listo para pasar a producción');
    root(h).querySelector<HTMLButtonElement>('[data-testid="production-open"]')?.click();
    await settle(h);
    expect(root(h).querySelector<HTMLButtonElement>('[data-testid="production-confirm"]')?.disabled).toBe(true);
    expect(root(h).querySelector('#production-word')).not.toBeNull();
  });

  it('shows the four Figma indicators and the total row', async () => {
    const h = await open();
    http.expectOne(URL).flush(summary());
    await settle(h);
    const kpis = root(h).querySelector('[data-testid="fiscal-kpis"]')?.textContent ?? '';
    for (const label of ['Ambiente', 'Firma digital', 'Credenciales SIAT', 'Catálogos del SIN']) expect(kpis).toContain(label);
    expect(root(h).textContent).toContain('7 secciones · 6 completas · 1 por atender');
  });

  it('says it already invoices in production and hides the button', async () => {
    const h = await open();
    http.expectOne(URL).flush(summary({ environment: 'PRODUCTION', productionEnabledAt: '2026-11-16T14:00:00.000Z' }));
    await settle(h);
    expect(root(h).querySelector('[data-testid="production-note"]')).not.toBeNull();
    expect(root(h).querySelector('[data-testid="production-open"]')).toBeNull();
  });

  it('shows the error state with a retry, and the no-permission state', async () => {
    const h = await open();
    http.expectOne(URL).flush({ code: 'X', message: 'boom' }, { status: 500, statusText: 'Server Error' });
    await settle(h);
    expect(root(h).textContent).toContain('No pudimos cargar la configuración fiscal');
    root(h).querySelector<HTMLButtonElement>('section[role="alert"] button')?.click();
    http.expectOne(URL).flush({ code: 'FORBIDDEN', message: 'no' }, { status: 403, statusText: 'Forbidden' });
    await settle(h);
    expect(root(h).textContent).toContain('No tienes permiso para ver la configuración fiscal');
  });
});
