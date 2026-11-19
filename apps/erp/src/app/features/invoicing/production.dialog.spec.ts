import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ProductionReadiness } from '@rodasoft/domain';
import { ProductionDialog } from './production.dialog';

const URL = '/api/v1/invoicing/fiscal-settings/production';

describe('ProductionDialog (FS-36)', () => {
  let http: HttpTestingController;

  async function render(readiness: ProductionReadiness) {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ProductionDialog);
    fixture.componentRef.setInput('readiness', readiness);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }
  type Fixture = Awaited<ReturnType<typeof render>>;
  const el = (f: Fixture) => f.nativeElement as HTMLElement;
  const confirm = (f: Fixture) => el(f).querySelector<HTMLButtonElement>('[data-testid="production-confirm"]')!;
  const type = (f: Fixture, text: string) => {
    const box = el(f).querySelector<HTMLInputElement>('#production-word')!;
    box.value = text;
    box.dispatchEvent(new Event('input'));
    f.detectChanges();
  };

  afterEach(() => http.verify());

  it('lists what is missing and stays disabled', async () => {
    const f = await render({ ready: false, requirements: ['SIGNATURE_MISSING', 'GATEWAY_SIMULATED'] });
    const text = el(f).querySelector('[data-testid="production-missing"]')?.textContent ?? '';
    expect(text).toContain('Falta cargar la firma digital');
    expect(text).toContain('El SIAT todavía es el simulador');
    expect(confirm(f).disabled).toBe(true);
    expect(el(f).querySelector('#production-word')).toBeNull();
  });

  it('enables the button only when PRODUCCIÓN is typed exactly', async () => {
    const f = await render({ ready: true, requirements: [] });
    expect(el(f).querySelector('[data-testid="production-warning"]')).not.toBeNull();
    expect(confirm(f).disabled).toBe(true);
    type(f, 'produccion');
    expect(confirm(f).disabled).toBe(true);
    type(f, 'PRODUCCIÓN');
    expect(confirm(f).disabled).toBe(false);
  });

  it('sends the word, closes and tells the screen', async () => {
    const f = await render({ ready: true, requirements: [] });
    const switched = jest.fn();
    f.componentInstance.switched.subscribe(switched);
    type(f, 'PRODUCCIÓN');
    confirm(f).click();
    const req = http.expectOne(URL);
    expect(req.request.body).toEqual({ confirmation: 'PRODUCCIÓN' });
    req.flush({ environment: 'PRODUCTION', productionEnabledAt: '2026-11-16T14:00:00.000Z' });
    await f.whenStable();
    expect(switched).toHaveBeenCalled();
    expect(f.componentInstance.open()).toBe(false);
  });

  it('keeps the dialog open and says why the API refused', async () => {
    const f = await render({ ready: true, requirements: [] });
    type(f, 'PRODUCCIÓN');
    confirm(f).click();
    http.expectOne(URL).flush({ code: 'ALREADY_PRODUCTION', message: 'x' }, { status: 409, statusText: 'Conflict' });
    await f.whenStable();
    f.detectChanges();
    expect(el(f).querySelector('[data-testid="production-error"]')?.textContent).toContain('ya factura en producción');
    expect(f.componentInstance.open()).toBe(true);
  });
});
