import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { DuplicateProductResponse, ProductFilterOptions, ProductListItem } from '@rodasoft/domain';
import { DuplicateProductDialog } from './duplicate-product.dialog';

const OPTIONS: ProductFilterOptions = {
  countries: [
    { id: 'c-se', code: 'SE', name: 'Suecia' },
    { id: 'c-jp', code: 'JP', name: 'Japón' },
  ],
  brands: [
    { id: 'b-skf', name: 'SKF', logoUrl: null, countryId: 'c-se' },
    { id: 'b-nsk', name: 'NSK', logoUrl: null, countryId: 'c-jp' },
  ],
  categories: [],
};

const PRODUCT: ProductListItem = {
  id: 'p1',
  sku: 'RL-000001',
  manufacturerCode: '6205-2RS',
  name: 'Rodamiento rígido',
  photoUrl: null,
  brand: { id: 'b-skf', name: 'SKF', logoUrl: null },
  country: { id: 'c-se', code: 'SE', name: 'Suecia' },
  category: { id: 'k-1', name: 'Rodamientos', icon: 'bearing' },
  subcategory: null,
  dimensions: null,
  specs: [],
  totalStock: 0,
  branchStock: null,
  salePrice: '10.00',
  status: 'ACTIVE',
};

@Component({
  imports: [DuplicateProductDialog],
  template: `<rs-duplicate-product-dialog
    [(open)]="open"
    [product]="product"
    [options]="options"
    (created)="created.set($event)"
  />`,
})
class HostComponent {
  readonly open = signal(true);
  readonly product = PRODUCT;
  readonly options = OPTIONS;
  readonly created = signal<DuplicateProductResponse | null>(null);
}

describe('DuplicateProductDialog', () => {
  let http: HttpTestingController;

  async function setup() {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const code = () => el.querySelector<HTMLInputElement>('#duplicate-code')!;
    const submit = () => el.querySelector<HTMLButtonElement>('button[type=submit]')!;
    const type = async (value: string) => {
      code().value = value;
      code().dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    const send = async () => {
      submit().click();
      await fixture.whenStable();
    };
    return { fixture, el, type, send, host: fixture.componentInstance };
  }

  afterEach(() => http.verify());

  it('shows the source, the required code, the defaults and the disabled equivalences chip', async () => {
    const { el } = await setup();
    const t = el.textContent ?? '';
    expect(t).toContain('Duplicar producto');
    expect(t).toContain('Crea una copia de 6205-2RS · SKF');
    expect(t).toContain('Código nuevo');
    expect(t).toContain('Debe ser único para la marca.');
    expect(t).toContain('El stock no se copia');

    const chips = Array.from(el.querySelectorAll<HTMLButtonElement>('rs-filter-chip button'));
    const byText = (label: string) => chips.find((c) => c.textContent?.includes(label))!;
    expect(byText('Dimensiones').getAttribute('aria-pressed')).toBe('true');
    expect(byText('Especificaciones').getAttribute('aria-pressed')).toBe('true');
    expect(byText('Precio').getAttribute('aria-pressed')).toBe('true');
    expect(byText('Fotos y ficha técnica').getAttribute('aria-pressed')).toBe('false');
    expect(byText('Equivalencias').disabled).toBe(true);
    // the industry select shows the product's country with its flag
    expect(el.querySelectorAll('rs-select rs-flag')).toHaveLength(1);
    expect(el.querySelector('#duplicate-country')?.textContent).toContain('Suecia');
  });

  it('does not call the API and flags the code as required when it is empty', async () => {
    const { el, send, host } = await setup();
    await send();
    expect(el.textContent).toContain('Ingresa el código nuevo.');
    expect(host.open()).toBe(true);
  });

  it('sends the new code, the default brand and industry and the toggled parts, then closes', async () => {
    const { el, type, send, fixture, host } = await setup();
    await type('  6205-2RS-B ');
    const photos = Array.from(el.querySelectorAll<HTMLButtonElement>('rs-filter-chip button')).find((c) =>
      c.textContent?.includes('Fotos'),
    )!;
    photos.click();
    await fixture.whenStable();
    await send();

    const req = http.expectOne('/api/v1/inventory/products/p1/duplicate');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      manufacturerCode: '6205-2RS-B',
      brandId: 'b-skf',
      countryId: 'c-se',
      copy: ['dimensions', 'specifications', 'price', 'media'],
    });
    req.flush({ id: 'p9', sku: 'RL-000009' });
    await fixture.whenStable();
    expect(host.created()).toEqual({ id: 'p9', sku: 'RL-000009' });
    expect(host.open()).toBe(false);
  });

  it('shows an inline error on the code field and stays open on a 409', async () => {
    const { el, type, send, fixture, host } = await setup();
    await type('6205-2RS');
    await send();
    http
      .expectOne('/api/v1/inventory/products/p1/duplicate')
      .flush({ code: 'DUPLICATE_MANUFACTURER_CODE', message: 'exists' }, { status: 409, statusText: 'Conflict' });
    await fixture.whenStable();
    expect(el.querySelector('#duplicate-code-error')?.textContent).toContain('Ya existe un producto con este código para la marca.');
    expect(el.querySelector('#duplicate-code')?.getAttribute('aria-invalid')).toBe('true');
    expect(host.open()).toBe(true);
    expect(host.created()).toBeNull();

    // editing the code clears the stale error
    await type('6205-2RS-C');
    expect(el.querySelector('#duplicate-code-error')).toBeNull();
  });
});
