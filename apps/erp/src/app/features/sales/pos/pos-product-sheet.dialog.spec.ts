import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { PosEquivalentItem, PosProductSheet } from '@rodasoft/domain';
import { PosProductSheetDialog, type PosSheetAdd } from './pos-product-sheet.dialog';

const url = (id: string) => `/api/v1/sales/pos/products/${id}/sheet`;

const equivalent = (over: Partial<PosEquivalentItem> = {}): PosEquivalentItem => ({
  productId: 'e1',
  code: '6205-2RSR',
  name: 'Rodamiento',
  brand: { name: 'FAG', initials: 'FA' },
  salePrice: '245.00',
  available: 3,
  kind: 'EXACT',
  differences: [],
  substitute: false,
  notes: null,
  measures: null,
  ...over,
});

const sheetOf = (over: Partial<PosProductSheet> = {}, product: Partial<PosProductSheet['product']> = {}): PosProductSheet => ({
  product: {
    id: 'p1',
    sku: 'RL-000124',
    manufacturerCode: '6205-2RS',
    name: 'Rodamiento rígido de bolas',
    unit: 'UN',
    status: 'ACTIVE',
    brand: { id: 'b', name: 'SKF', logoUrl: null },
    country: { id: 'c', code: 'SE', name: 'Suecia' },
    category: { id: 'c', name: 'Rodamientos', icon: 'bearing' },
    subcategory: null,
    dimensions: { innerDiameter: '25', outerDiameter: '52', width: '15', weight: null },
    specs: [],
    salePrice: '245.00',
    sectors: ['Minería'],
    totalStock: 30,
    stockByBranch: [
      { branchId: 'b1', branchName: 'Central', warehouses: ['Central'], quantity: 24, minStock: 5, maxStock: 60, location: null, availability: 'available' },
      { branchId: 'b2', branchName: 'Sacaba', warehouses: ['Sacaba'], quantity: 0, minStock: 2, maxStock: null, location: null, availability: 'out' },
    ],
    photos: [],
    datasheetUrl: null,
    ...product,
  },
  available: 24,
  stockStatus: 'ok',
  maxQuantity: 24,
  warehouse: { id: 'w1', name: 'Central' },
  branchId: 'b1',
  equivalents: [
    equivalent(),
    equivalent({ productId: 'e2', code: '6205-2Z', kind: 'WITH_DIFFERENCES', differences: [{ key: 'seal', label: 'Sello', source: '2RS', other: '2Z' }] }),
  ],
  ...over,
});

@Component({
  imports: [PosProductSheetDialog],
  template: `<rs-pos-product-sheet-dialog [(open)]="open" [productId]="productId()" (add)="added.push($event)" />`,
})
class Host {
  readonly open = signal(true);
  readonly productId = signal<string | null>('p1');
  readonly added: PosSheetAdd[] = [];
}

describe('PosProductSheetDialog', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<Host>;

  function create() {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  }
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const body = () => document.body;
  const text = () => body().textContent ?? '';
  const button = (label: string) =>
    Array.from(body().querySelectorAll('button')).find((b) => b.textContent?.includes(label) || b.getAttribute('aria-label') === label);
  async function show(sheet: PosProductSheet = sheetOf()) {
    create();
    await settle();
    http.expectOne(url('p1')).flush(sheet);
    await settle();
  }

  afterEach(() => {
    http.verify();
    fixture.destroy();
  });

  it('shows a skeleton while it loads', async () => {
    create();
    await settle();
    expect(body().querySelector('[aria-busy=true]')).not.toBeNull();
    http.expectOne(url('p1')).flush(sheetOf());
  });

  it('shows brand, origin, code, sectors, dimensions, price, stock per branch and equivalents', async () => {
    await show();
    expect(text()).toContain('País de origen:');
    expect(text()).toContain('Suecia');
    expect(text()).toContain('6205-2RS');
    expect(text()).toContain('RL-000124');
    expect(text()).toContain('Minería');
    expect(text()).toContain('Dimensiones');
    expect(text()).toContain('25 mm');
    expect(body().querySelector('rs-bearing-diagram')).not.toBeNull();
    expect(body().querySelector('[data-testid=pos-sheet-price]')?.textContent).toContain('Bs 245,00');
    expect(text()).toContain('Precio único por empresa · 24 en esta sucursal');
    expect(text()).toContain('Mínimo 5 · máximo 60');
    expect(body().querySelector('rs-stock-flag[aria-label="Agotado"]')).not.toBeNull();
    expect(text()).toContain('2 referencias de otras marcas');
    expect(text()).toContain('Exacta');
    expect(text()).toContain('Con diferencias');
    expect(text()).toContain('El costo no se muestra en ventas');
  });

  it('shows the empty states with no photos, no dimensions and no equivalents', async () => {
    await show(sheetOf({ equivalents: [] }, { dimensions: null }));
    expect(text()).toContain('Este producto no tiene fotos.');
    expect(text()).toContain('Este producto no tiene medidas registradas.');
    expect(text()).toContain('Sin equivalentes registrados.');
    expect(body().querySelector('rs-bearing-diagram')).toBeNull();
  });

  it('emits the product and the quantity from "Agregar a la venta"', async () => {
    await show();
    button('Sumar uno')?.click();
    await settle();
    button('Agregar a la venta')?.click();
    expect(fixture.componentInstance.added).toEqual([{ productId: 'p1', quantity: 2 }]);
  });

  it('is out of stock here: the button reads "Agotado aquí" and is disabled', async () => {
    await show(sheetOf({ available: 0, stockStatus: 'out', maxQuantity: 0 }));
    const add = button('Agotado aquí') as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    add.click();
    expect(fixture.componentInstance.added).toEqual([]);
  });

  it('opens an equivalent in the same modal and goes back with "Volver"', async () => {
    await show();
    expect(button('Volver')).toBeUndefined();
    button('Ver ficha de 6205-2RSR')?.click();
    await settle();
    http.expectOne(url('e1')).flush(sheetOf({}, { id: 'e1', manufacturerCode: '6205-2RSR' }));
    await settle();
    expect(button('Volver')).toBeDefined();
    button('Volver')?.click();
    await settle();
    // going back shows the original again, with fresh data
    http.expectOne(url('p1')).flush(sheetOf());
    await settle();
    expect(button('Volver')).toBeUndefined();
    expect(text()).toContain('Con diferencias');
  });

  it('answers "Producto no disponible" for a missing product', async () => {
    create();
    await settle();
    http.expectOne(url('p1')).flush({ code: 'PRODUCT_NOT_FOUND', message: 'x' }, { status: 404, statusText: 'Not Found' });
    await settle();
    expect(text()).toContain('Producto no disponible');
  });

  it('shows an error with a retry', async () => {
    create();
    await settle();
    http.expectOne(url('p1')).flush({}, { status: 500, statusText: 'Server Error' });
    await settle();
    expect(text()).toContain('No pudimos cargar la ficha técnica');
    button('Reintentar')?.click();
    await settle();
    http.expectOne(url('p1')).flush(sheetOf());
  });

  it('loads the product again when the sheet is reopened', async () => {
    await show();
    fixture.componentInstance.open.set(false);
    await settle();
    fixture.componentInstance.open.set(true);
    await settle();
    http.expectOne(url('p1')).flush(sheetOf({ available: 3, maxQuantity: 3 }));
    await settle();
    expect(text()).toContain('3 en esta sucursal');
  });

  it('closes with Escape', async () => {
    await show();
    body().querySelector('[role=dialog]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    expect(fixture.componentInstance.open()).toBe(false);
  });
});
