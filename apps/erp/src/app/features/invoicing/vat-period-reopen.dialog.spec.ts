import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { VatPeriodReopenDialog } from './vat-period-reopen.dialog';

const URL = '/api/v1/invoicing/vat-periods/2026-10/reopen';

describe('VatPeriodReopenDialog', () => {
  let http: HttpTestingController;

  async function render() {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(VatPeriodReopenDialog);
    fixture.componentRef.setInput('period', '2026-10');
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }
  type Fixture = Awaited<ReturnType<typeof render>>;
  const el = (f: Fixture) => f.nativeElement as HTMLElement;
  const confirm = (f: Fixture) => el(f).querySelector<HTMLButtonElement>('[data-testid="reopen-confirm"]')!;
  const type = (f: Fixture, text: string) => {
    const box = el(f).querySelector<HTMLTextAreaElement>('#reopen-reason')!;
    box.value = text;
    box.dispatchEvent(new Event('input'));
    f.detectChanges();
  };

  afterEach(() => http.verify());

  it('asks for a reason before it sends anything', async () => {
    const f = await render();
    confirm(f).click();
    f.detectChanges();
    expect(el(f).textContent).toContain('Escribe el motivo para reabrir el período.');
    type(f, 'corto');
    confirm(f).click();
    f.detectChanges();
    expect(el(f).textContent).toContain('el motivo es muy corto');
  });

  it('sends the trimmed reason, closes and tells the screen', async () => {
    const f = await render();
    const reopened = jest.fn();
    f.componentInstance.reopened.subscribe(reopened);
    type(f, '  Falta registrar una compra  ');
    confirm(f).click();
    const req = http.expectOne(URL);
    expect(req.request.body).toEqual({ reason: 'Falta registrar una compra' });
    req.flush({});
    await f.whenStable();
    expect(reopened).toHaveBeenCalled();
    expect(f.componentInstance.open()).toBe(false);
  });

  it('keeps the dialog open and says why the API refused', async () => {
    const f = await render();
    type(f, 'Falta registrar una compra');
    confirm(f).click();
    http.expectOne(URL).flush({ code: 'LATER_PERIOD_CLOSED', message: 'x' }, { status: 409, statusText: 'Conflict' });
    await f.whenStable();
    f.detectChanges();
    expect(el(f).querySelector('[data-testid="reopen-error"]')?.textContent).toContain('período posterior está cerrado');
    expect(f.componentInstance.open()).toBe(true);
  });
});
