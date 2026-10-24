import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { AttributeDefinitionItem, ProductDetail, ProductEditModel, ProductFilterOptions } from '@rodasoft/domain';
import { ToastService } from '@rodasoft/ui';
import { ContextStore } from '../../../../core/context.store';
import { ProductWizardPage } from './product-wizard.page';

@Component({ selector: 'rs-blank', template: '' })
class BlankPage {}

const OPTIONS_URL = '/api/v1/inventory/filter-options';
const EDIT_URL = '/api/v1/inventory/products/p1/edit-model';
const PATCH_URL = '/api/v1/inventory/products/p1';
const DEFINITIONS_URL = '/api/v1/inventory/categories/k-balls/attribute-definitions';

const options: ProductFilterOptions = {
  countries: [{ id: 'c-se', code: 'SE', name: 'Suecia' }],
  brands: [
    { id: 'b-skf', name: 'SKF', logoUrl: null, countryId: 'c-se' },
    { id: 'b-fag', name: 'FAG', logoUrl: null, countryId: null },
  ],
  categories: [
    { id: 'k-bearings', name: 'Rodamientos', icon: 'bearing', subcategories: [{ id: 'k-balls', name: 'Rígidos de bolas' }] },
    { id: 'k-seals', name: 'Retenes y sellos', icon: 'seal', subcategories: [] },
  ],
};

const definitions: AttributeDefinitionItem[] = [
  { key: 'series', label: 'Serie', type: 'TEXT', unit: null, options: null, required: false, step: 2, sortOrder: 0 },
  { key: 'seal', label: 'Sello', type: 'ENUM', unit: null, options: ['Abierto', '2RS'], required: true, step: 3, sortOrder: 0 },
];

const product = (over: Partial<ProductDetail> = {}): ProductDetail => ({
  id: 'p1',
  sku: 'RL-000001',
  manufacturerCode: '6205-2RS',
  name: 'Rodamientos SKF 6205-2RS',
  unit: 'UN',
  status: 'ACTIVE',
  hasMovements: false,
  brand: { id: 'b-skf', name: 'SKF', logoUrl: null },
  country: { id: 'c-se', code: 'SE', name: 'Suecia' },
  category: { id: 'k-bearings', name: 'Rodamientos', icon: 'bearing' },
  subcategory: { id: 'k-balls', name: 'Rígidos de bolas' },
  dimensions: { innerDiameter: '25.000', outerDiameter: '52.000', width: '15.000', weight: '0.130' },
  specs: [
    { key: 'series', step: 2, label: 'Serie', type: 'TEXT', unit: null, value: '62' },
    { key: 'seal', step: 3, label: 'Sello', type: 'ENUM', unit: null, value: '2RS' },
  ],
  extra: { tariffCode: '8482.10', supplierName: 'Distribuidora Andina', sectors: 'Minería' },
  pricing: { salePrice: '245.00', cost: '120.0000', marginPercent: '51.0' },
  totalStock: 60,
  stockByBranch: [
    { branchId: 'a', branchName: 'Central', warehouses: ['Principal'], quantity: 60, minStock: 6, maxStock: 80, location: 'A-03-2', availability: 'available' },
  ],
  photos: [],
  datasheetUrl: null,
  createdAt: '2026-10-22T15:00:00.000Z',
  updatedAt: '2026-10-23T15:00:00.000Z',
  createdBy: { id: 'u1', name: 'Ana Rojas' },
  updatedBy: null,
  ...over,
});

const model = (over: Partial<ProductEditModel> = {}): ProductEditModel => ({
  product: product(),
  hasMovements: false,
  countryId: 'c-se',
  entryDate: '2026-10-01',
  thresholds: [{ branchId: 'a', minStock: 6, maxStock: 80, location: 'A-03-2' }],
  ...over,
});

interface Internals {
  stepIndex: { set(value: number): void };
  form: { controls: Record<string, { setValue(v: unknown): void; markAsDirty(): void; disabled: boolean; value: unknown }> };
  saveChanges(): void;
}

describe('ProductWizardPage in edit mode (HU-INV-07)', () => {
  let http: HttpTestingController;

  async function open(editModel: ProductEditModel = model(), granted: string[] = ['inventory.costs.view']) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'inventory/products/:id/edit', component: ProductWizardPage, data: { mode: 'edit' } },
          { path: 'inventory/products/:id', component: BlankPage },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ContextStore,
          useValue: {
            can: (p: string) => granted.includes(p),
            currentBranch: () => ({ id: 'a' }),
            branches: () => [{ id: 'a', name: 'Central' }],
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/inventory/products/p1/edit', ProductWizardPage);
    http.expectOne(OPTIONS_URL).flush(options);
    http.expectOne(EDIT_URL).flush(editModel);
    answerDefinitions();
    harness.detectChanges();
    return harness;
  }

  /** The definitions are asked once per category change; an earlier request that was cancelled is skipped. */
  const answerDefinitions = () =>
    http.match(DEFINITIONS_URL).forEach((req) => {
      if (!req.cancelled) req.flush({ categoryId: 'k-balls', definedOn: 'k-bearings', items: definitions });
    });

  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  const page = (h: RouterTestingHarness) => h.routeDebugElement?.componentInstance as unknown as Internals;
  const goTo = (h: RouterTestingHarness, index: number) => {
    page(h).stepIndex.set(index);
    h.detectChanges();
    // the equivalences step asks for suggestions as soon as it opens
    http.match((r) => r.url.endsWith('/equivalence-suggestions')).forEach((req) => req.flush({ items: [] }));
    h.detectChanges();
  };
  const button = (h: RouterTestingHarness, label: string) =>
    Array.from(root(h).querySelectorAll('button')).find((b) => b.textContent?.includes(label));
  const header = (h: RouterTestingHarness) => root(h).querySelector('rs-page-header')?.textContent ?? '';

  it('opens "Editar {code}" with the six steps of a bearing, and says changes are saved at the end', async () => {
    const h = await open();

    expect(header(h)).toContain('Editar 6205-2RS');
    expect(header(h)).toContain('Editando · Paso 1 de 6 · Identificación · los cambios se guardan al final');
    expect(root(h).querySelectorAll('rs-stepper button').length).toBe(6);
  });

  it('pre-fills the identification and shows the stored SKU', async () => {
    const h = await open();

    expect((root(h).querySelector('#wizard-code') as HTMLInputElement).value).toBe('6205-2RS');
    expect((root(h).querySelector('#wizard-sku') as HTMLInputElement).value).toBe('RL-000001');
    expect((root(h).querySelector('#wizard-name') as HTMLInputElement).value).toBe('Rodamientos SKF 6205-2RS');
    expect(page(h).form.controls['brandId'].value).toBe('b-skf');
    expect(page(h).form.controls['subcategoryId'].value).toBe('k-balls');
    expect(page(h).form.controls['countryId'].value).toBe('c-se');
  });

  it('pre-fills dimensions, price, cost, thresholds, supplier, tariff code and entry date', async () => {
    const h = await open();
    const values = (name: string) => page(h).form.controls[name].value;

    expect([values('innerDiameter'), values('outerDiameter'), values('width'), values('weight')]).toEqual(['25.000', '52.000', '15.000', '0.130']);
    expect([values('salePrice'), values('cost')]).toEqual(['245.00', '120.0000']);
    expect([values('minStock'), values('maxStock'), values('location')]).toEqual(['6', '80', 'A-03-2']);
    expect([values('supplierName'), values('tariffCode'), values('entryDate')]).toEqual(['Distribuidora Andina', '8482.10', '2026-10-01']);
    expect(values('sectors')).toEqual(['Minería']);
  });

  it('shows every step as completed and lets the user reach any of them', async () => {
    const h = await open();

    expect(root(h).textContent).toContain('3 de 3 requeridos');
    expect(root(h).querySelectorAll('rs-stepper li.item.done').length).toBe(5);
    (root(h).querySelectorAll('rs-stepper button')[3] as HTMLButtonElement).click();
    h.detectChanges();
    expect(header(h)).toContain('Paso 4 de 6 · Precio e inventario');
  });

  it('keeps "Guardar cambios" on every step, with no draft button and no "Omitir"', async () => {
    const h = await open();

    for (const index of [0, 1, 2, 3, 4, 5]) {
      goTo(h, index);
      expect(button(h, 'Guardar cambios')).toBeDefined();
      expect(button(h, 'Guardar borrador')).toBeUndefined();
      expect(button(h, 'Omitir este paso')).toBeUndefined();
    }
  });

  it('shows the current stock read-only with "Ajustar stock", and no receiving branch or initial stock', async () => {
    const h = await open();
    const info = jest.spyOn(TestBed.inject(ToastService), 'info');
    goTo(h, 3);

    expect(root(h).querySelector('#wizard-stock')).toBeNull();
    expect(root(h).querySelector('#wizard-branch')).toBeNull();
    const stock = root(h).querySelector('#wizard-current-stock') as HTMLInputElement;
    expect(stock.value).toBe('60');
    expect(stock.readOnly).toBe(true);
    button(h, 'Ajustar stock')?.click();
    expect(info).toHaveBeenCalledWith('Esta acción estará disponible próximamente.');
  });

  it('hides the cost without the costs permission', async () => {
    const h = await open(model({ product: product({ pricing: { salePrice: '245.00' } }) }), []);
    goTo(h, 3);

    expect(root(h).querySelector('#wizard-cost')).toBeNull();
  });

  it('keeps brand, category and subcategory editable while the product has no movements', async () => {
    const h = await open();

    for (const name of ['brandId', 'rootCategoryId', 'subcategoryId']) expect(page(h).form.controls[name].disabled).toBe(false);
    expect(root(h).textContent).not.toContain('No editable: el producto ya tiene movimientos');
  });

  it('locks brand, category and subcategory when the product has movements, with the reason', async () => {
    const h = await open(model({ hasMovements: true }));

    for (const name of ['brandId', 'rootCategoryId', 'subcategoryId']) expect(page(h).form.controls[name].disabled).toBe(true);
    expect(root(h).textContent).toContain('No editable: el producto ya tiene movimientos');
  });

  it('saves everything with one PATCH that carries the lock value and no stock fields, then opens the sheet', async () => {
    const h = await open();
    const success = jest.spyOn(TestBed.inject(ToastService), 'success');
    page(h).form.controls['salePrice'].setValue('249,90');

    page(h).saveChanges();
    const request = http.expectOne((r) => r.method === 'PATCH' && r.url === PATCH_URL);
    expect(request.request.body).toMatchObject({
      expectedUpdatedAt: '2026-10-23T15:00:00.000Z',
      manufacturerCode: '6205-2RS',
      brandId: 'b-skf',
      categoryId: 'k-balls',
      salePrice: '249.90',
      cost: '120.0000',
      attributes: { series: '62', seal: '2RS' },
    });
    for (const field of ['status', 'branchId', 'initialStock', 'minStock', 'maxStock', 'location', 'thresholdBranchId']) {
      expect(request.request.body).not.toHaveProperty(field);
    }
    request.flush({ id: 'p1', sku: 'RL-000001', updatedAt: '2026-10-23T16:00:00.000Z' });
    await h.fixture.whenStable();

    expect(TestBed.inject(Router).url).toBe('/inventory/products/p1');
    expect(success).toHaveBeenCalledWith('Cambios guardados');
  });

  it('sends the thresholds, for the current branch, only when the user touched them', async () => {
    const h = await open();
    page(h).form.controls['minStock'].setValue('10');
    page(h).form.controls['minStock'].markAsDirty();

    page(h).saveChanges();
    const request = http.expectOne((r) => r.method === 'PATCH' && r.url === PATCH_URL);

    expect(request.request.body).toMatchObject({ thresholdBranchId: 'a', minStock: 10, maxStock: 80, location: 'A-03-2' });
  });

  it('does not save while a required field is empty: it goes back to the step that owns it', async () => {
    const h = await open();
    page(h).form.controls['salePrice'].setValue('');
    goTo(h, 0);

    page(h).saveChanges();
    h.detectChanges();

    http.expectNone((r) => r.method === 'PATCH');
    expect(header(h)).toContain('Paso 4 de 6');
    expect(root(h).textContent).toContain('Falta el precio de venta.');
  });

  it('asks for a reload when someone else saved first (409 PRODUCT_MODIFIED), and reloads on "Recargar"', async () => {
    const h = await open();

    page(h).saveChanges();
    http.expectOne((r) => r.method === 'PATCH').flush({ code: 'PRODUCT_MODIFIED', message: 'x' }, { status: 409, statusText: 'Conflict' });
    h.detectChanges();

    expect(root(h).textContent).toContain('Otro usuario modificó este producto');
    button(h, 'Recargar')?.click();
    http.expectOne(OPTIONS_URL).flush(options);
    http.expectOne(EDIT_URL).flush(model({ product: product({ updatedAt: '2026-10-23T16:30:00.000Z' }) }));
    answerDefinitions();
    h.detectChanges();

    expect(root(h).textContent).not.toContain('Otro usuario modificó este producto');
  });

  it('shows the error with a retry when the product cannot be loaded', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'inventory/products/:id/edit', component: ProductWizardPage, data: { mode: 'edit' } }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ContextStore, useValue: { can: () => true, currentBranch: () => ({ id: 'a' }), branches: () => [] } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/inventory/products/p1/edit', ProductWizardPage);
    http.expectOne(OPTIONS_URL).flush(options);
    http.expectOne(EDIT_URL).flush({ code: 'PRODUCT_NOT_FOUND', message: 'x' }, { status: 404, statusText: 'Not Found' });
    harness.detectChanges();

    expect(root(harness).textContent).toContain('El producto ya no existe. Actualiza el listado.');
    expect(button(harness, 'Reintentar')).toBeDefined();
  });

  it('asks before leaving with unsaved changes, and says the changes would be lost', async () => {
    const h = await open();
    page(h).form.controls['salePrice'].markAsDirty();

    button(h, 'Cancelar')?.click();
    h.detectChanges();

    expect(root(h).textContent).toContain('¿Salir sin guardar?');
    expect(root(h).textContent).toContain('Los cambios que hiciste se perderán.');
  });
});
