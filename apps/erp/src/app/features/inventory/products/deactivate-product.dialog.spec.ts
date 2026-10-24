import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ProductStatusResponse } from '@rodasoft/domain';
import { DeactivateProductDialog } from './deactivate-product.dialog';

const URL = '/api/v1/inventory/products/p1/deactivate';

@Component({
  imports: [DeactivateProductDialog],
  template: `<rs-deactivate-product-dialog
    [(open)]="open"
    [product]="product()"
    (deactivated)="deactivated.set($event)"
  />`,
})
class HostComponent {
  readonly open = signal(true);
  readonly product = signal<{ id: string; manufacturerCode: string } | null>({ id: 'p1', manufacturerCode: '6205-2RS' });
  readonly deactivated = signal<ProductStatusResponse | null>(null);
}

describe('DeactivateProductDialog', () => {
  let http: HttpTestingController;

  async function setup() {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const button = (label: string) =>
      Array.from(el.querySelectorAll('[role=dialog] button')).find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
    return { fixture, el, button, host: fixture.componentInstance };
  }

  afterEach(() => http.verify());

  it('names the product and says what is kept', async () => {
    const { el } = await setup();
    const text = el.textContent ?? '';
    expect(text).toContain('¿Desactivar 6205-2RS?');
    expect(text).toContain('dejará de mostrarse en ventas y en la tienda');
    expect(text).toContain('Conserva su historial y su stock');
  });

  it('deactivates, closes, reports it and emits the result', async () => {
    const { fixture, el, button, host } = await setup();

    button('Desactivar').click();
    const req = http.expectOne(URL);
    expect(req.request.method).toBe('POST');
    const body: ProductStatusResponse = { id: 'p1', sku: 'RL-000001', status: 'INACTIVE', updatedAt: '2026-10-24T10:00:00Z' };
    req.flush(body);
    await fixture.whenStable();

    expect(host.open()).toBe(false);
    expect(host.deactivated()).toEqual(body);
    expect(el.querySelector('[role=dialog]')).toBeNull();
  });

  it('does not call the API when cancelled', async () => {
    const { fixture, button, host } = await setup();

    button('Cancelar').click();
    await fixture.whenStable();

    expect(host.open()).toBe(false);
    http.expectNone(URL);
  });

  it('sends one request while saving and blocks Cancelar', async () => {
    const { fixture, button, host } = await setup();

    button('Desactivar').click();
    fixture.detectChanges();
    button('Desactivar').click();
    expect(button('Cancelar').disabled).toBe(true);
    http.expectOne(URL);
    expect(host.open()).toBe(true);
  });

  it('stays open with the error in Spanish when the status already changed', async () => {
    const { fixture, el, button, host } = await setup();

    button('Desactivar').click();
    http.expectOne(URL).flush({ code: 'INVALID_STATUS_TRANSITION', message: 'x' }, { status: 409, statusText: 'Conflict' });
    await fixture.whenStable();

    expect(host.open()).toBe(true);
    expect(host.deactivated()).toBeNull();
    expect(el.textContent).toContain('El estado del producto cambió.');
    expect(button('Desactivar').disabled).toBe(false);
  });

  it('shows the 404 message when the product is gone', async () => {
    const { fixture, el, button } = await setup();

    button('Desactivar').click();
    http.expectOne(URL).flush({ code: 'PRODUCT_NOT_FOUND', message: 'x' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();

    expect(el.textContent).toContain('El producto ya no existe.');
  });
});
