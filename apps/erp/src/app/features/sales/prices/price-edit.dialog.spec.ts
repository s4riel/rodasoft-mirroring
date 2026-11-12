import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { PriceDetail } from '@rodasoft/domain';
import { ToastService } from '@rodasoft/ui';
import { PriceEditDialog } from './price-edit.dialog';
import { priceDetail } from './prices.testing';

const URL = '/api/v1/sales/prices/p1';

@Component({
  imports: [PriceEditDialog],
  template: `<rs-price-edit-dialog [(open)]="open" [productId]="productId()" (saved)="saved.set($event)" />`,
})
class HostComponent {
  readonly open = signal(true);
  readonly productId = signal<string | null>('p1');
  readonly saved = signal<PriceDetail | null>(null);
}

/** VP-11b · Editar precio (HU-VEN-26). */
describe('PriceEditDialog', () => {
  let http: HttpTestingController;
  const toast = { success: jest.fn(), warning: jest.fn() };

  async function setup(detail: PriceDetail | { status: number } = priceDetail()) {
    toast.success.mockClear();
    toast.warning.mockClear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: ToastService, useValue: toast }],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const req = http.expectOne(URL);
    expect(req.request.method).toBe('GET');
    if ('status' in detail && typeof detail.status === 'number') req.flush({ message: 'x' }, { status: detail.status, statusText: 'Error' });
    else req.flush(detail);
    await settle(fixture);
    return { fixture, el: fixture.nativeElement as HTMLElement, host: fixture.componentInstance };
  }

  async function settle(fixture: ComponentFixture<HostComponent>) {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function type(fixture: ComponentFixture<HostComponent>, selector: string, value: string) {
    const input = (fixture.nativeElement as HTMLElement).querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(fixture);
  }

  const byId = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const save = (el: HTMLElement) => (byId(el, 'price-save') as HTMLButtonElement).click();
  const text = (el: HTMLElement) => el.textContent?.replace(/\s+/g, ' ') ?? '';

  afterEach(() => http.verify());

  it('shows the product, its current price and the fields', async () => {
    const { el } = await setup();
    expect(text(el)).toContain('Editar precio · 6205-2RS');
    expect(byId(el, 'price-subtitle')?.textContent).toContain('Rodamiento rígido de bolas · SKF · precio actual Bs 245,00');
    expect(text(el)).toContain('Nuevo precio (Bs)');
    expect(text(el)).toContain('Motivo (opcional)');
    expect(text(el)).toContain('Cancelar');
    expect(text(el)).toContain('Guardar precio');
    expect(byId(el, 'price-change')?.textContent).toContain('—');
  });

  it('previews the change in Bs and percent while typing', async () => {
    const { fixture, el } = await setup();
    await type(fixture, '#price-new', '255');
    expect(byId(el, 'price-change')?.textContent).toContain('+ Bs 10,00 · +4,1 %');
    await type(fixture, '#price-new', '240,00');
    expect(byId(el, 'price-change')?.textContent).toContain('− Bs 5,00 · −2,0 %');
    await type(fixture, '#price-new', 'abc');
    expect(byId(el, 'price-change')?.textContent).toContain('—');
  });

  it('hides the cost and the margins from who cannot see costs', async () => {
    const { el } = await setup();
    expect(byId(el, 'price-cost')).toBeNull();
    expect(text(el)).not.toContain('Margen');
  });

  it('shows the cost, the current margin and the margin with the new price with inventory.costs.view', async () => {
    const { fixture, el } = await setup(priceDetail({ cost: '147.0000', marginPercent: '40.0' }));
    expect(byId(el, 'price-cost')?.textContent).toContain('Bs 147,00');
    expect(text(el)).toContain('Margen actual');
    expect(text(el)).toContain('40,0 %');
    expect(byId(el, 'price-new-margin')?.textContent).toContain('—');
    await type(fixture, '#price-new', '294');
    // (294 − 147) / 294
    expect(byId(el, 'price-new-margin')?.textContent).toContain('50,0 %');
  });

  it('saves the new price with the one it showed and the reason, then closes', async () => {
    const { fixture, el, host } = await setup();
    await type(fixture, '#price-new', '255,00');
    await type(fixture, '#price-reason', '  Nueva lista del proveedor  ');
    save(el);
    const req = http.expectOne(URL);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ newPrice: '255.00', expectedPrice: '245.00', reason: 'Nueva lista del proveedor' });
    req.flush(priceDetail({ salePrice: '255.00' }));
    await settle(fixture);

    expect(host.saved()?.salePrice).toBe('255.00');
    expect(host.open()).toBe(false);
    expect(toast.success).toHaveBeenCalledWith('Precio de 6205-2RS actualizado a Bs 255,00');
  });

  it('sends no reason when it is left empty', async () => {
    const { fixture, el } = await setup();
    await type(fixture, '#price-new', '260');
    save(el);
    const req = http.expectOne(URL);
    expect(req.request.body).toEqual({ newPrice: '260.00', expectedPrice: '245.00', reason: undefined });
    req.flush(priceDetail({ salePrice: '260.00' }));
  });

  it.each([
    ['', 'Ingresa un precio mayor que cero'],
    ['0', 'Ingresa un precio mayor que cero'],
    ['10,123', 'Ingresa un precio mayor que cero'],
    ['245,00', 'El precio nuevo es igual al actual.'],
  ])('does not save the price %j', async (value, message) => {
    const { fixture, el, host } = await setup();
    await type(fixture, '#price-new', value);
    save(el);
    await settle(fixture);
    http.expectNone((r) => r.method === 'PATCH');
    expect(text(el)).toContain(message);
    expect(host.open()).toBe(true);
  });

  it('reloads the current price when someone else changed it, and keeps the dialog open', async () => {
    const { fixture, el, host } = await setup();
    await type(fixture, '#price-new', '255');
    save(el);
    http
      .expectOne((r) => r.method === 'PATCH')
      .flush({ code: 'PRICE_CHANGED', message: 'x', details: { currentPrice: '250.00' } }, { status: 409, statusText: 'Conflict' });
    http.expectOne((r) => r.method === 'GET' && r.url === URL).flush(priceDetail({ salePrice: '250.00' }));
    await settle(fixture);

    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('Otra persona cambió este precio'));
    expect(host.open()).toBe(true);
    expect(byId(el, 'price-changed-note')).not.toBeNull();
    expect(byId(el, 'price-subtitle')?.textContent).toContain('precio actual Bs 250,00');
    // what was typed stays, now measured against the new current price
    expect((el.querySelector('#price-new') as HTMLInputElement).value).toBe('255');
    expect(byId(el, 'price-change')?.textContent).toContain('+ Bs 5,00 · +2,0 %');

    save(el);
    const retry = http.expectOne((r) => r.method === 'PATCH');
    expect(retry.request.body).toMatchObject({ newPrice: '255.00', expectedPrice: '250.00' });
    retry.flush(priceDetail({ salePrice: '255.00' }));
  });

  it('shows another server error in Spanish and stays open', async () => {
    const { fixture, el, host } = await setup();
    await type(fixture, '#price-new', '255');
    save(el);
    http.expectOne((r) => r.method === 'PATCH').flush({ code: 'PRODUCT_NOT_FOUND', message: 'x' }, { status: 404, statusText: 'Not Found' });
    await settle(fixture);
    expect(byId(el, 'price-error')?.textContent).toContain('El producto ya no existe');
    expect(host.open()).toBe(true);
  });

  it('shows the load error with a retry', async () => {
    const { fixture, el } = await setup({ status: 500 });
    expect(byId(el, 'price-load-error')).not.toBeNull();
    expect(byId(el, 'price-save')).toBeNull();
    (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Reintentar')) as HTMLButtonElement).click();
    http.expectOne(URL).flush(priceDetail());
    await settle(fixture);
    expect(byId(el, 'price-subtitle')?.textContent).toContain('precio actual Bs 245,00');
  });

  it('says so, without a retry, when the load is refused with 403', async () => {
    const { el } = await setup({ status: 403 });
    expect(byId(el, 'price-forbidden')?.textContent).toContain('Pide acceso al administrador');
    expect(byId(el, 'price-load-error')).toBeNull();
    expect(Array.from(el.querySelectorAll('button')).some((b) => b.textContent?.includes('Reintentar'))).toBe(false);
  });

  it('puts the focus back on the price after a failed submit', async () => {
    const { fixture, el } = await setup();
    await type(fixture, '#price-new', '0');
    save(el);
    await settle(fixture);
    expect(document.activeElement).toBe(el.querySelector('#price-new'));
  });

  it('loads the product again each time it opens', async () => {
    const { fixture, el, host } = await setup();
    await type(fixture, '#price-new', '999');
    host.open.set(false);
    await settle(fixture);
    host.open.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    http.expectOne(URL).flush(priceDetail({ salePrice: '300.00' }));
    await settle(fixture);
    expect(byId(el, 'price-subtitle')?.textContent).toContain('precio actual Bs 300,00');
    expect((el.querySelector('#price-new') as HTMLInputElement).value).toBe('');
  });
});
