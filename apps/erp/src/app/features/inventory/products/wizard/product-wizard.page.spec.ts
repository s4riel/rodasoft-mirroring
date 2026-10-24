import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { AttributeDefinitionItem, ProductFilterOptions } from '@rodasoft/domain';
import { ContextStore } from '../../../../core/context.store';
import { ProductWizardPage } from './product-wizard.page';

const OPTIONS_URL = '/api/v1/inventory/filter-options';

const options: ProductFilterOptions = {
  countries: [],
  brands: [{ id: 'b-skf', name: 'SKF', logoUrl: null, countryId: null }],
  categories: [
    { id: 'k-seals', name: 'Retenes y sellos', icon: 'seal', subcategories: [] },
    { id: 'k-bearings', name: 'Rodamientos', icon: 'bearing', subcategories: [] },
  ],
};

const definition = (over: Partial<AttributeDefinitionItem>): AttributeDefinitionItem => ({
  key: 'material',
  label: 'Material',
  type: 'TEXT',
  unit: null,
  options: null,
  required: true,
  step: 3,
  sortOrder: 0,
  ...over,
});

type Internals = { stepIndex: { set(value: number): void } };

describe('ProductWizardPage', () => {
  let http: HttpTestingController;

  /** Opens the wizard of a category and answers the two requests it makes on start. */
  async function open(categoryId: string, definitions: AttributeDefinitionItem[], granted: string[] = []) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'inventory/products/new/:categoryId', component: ProductWizardPage }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ContextStore,
          useValue: {
            can: (p: string) => granted.includes(p),
            currentBranch: () => ({ id: 'br-1' }),
            branches: () => [{ id: 'br-1', name: 'Central' }],
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(`/inventory/products/new/${categoryId}`, ProductWizardPage);
    http.expectOne(OPTIONS_URL).flush(options);
    http.expectOne(`/api/v1/inventory/categories/${categoryId}/attribute-definitions`).flush({ categoryId, definedOn: categoryId, items: definitions });
    harness.detectChanges();
    return harness;
  }

  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  const goTo = (h: RouterTestingHarness, index: number) => {
    (h.routeDebugElement?.componentInstance as unknown as Internals).stepIndex.set(index);
    h.detectChanges();
  };
  const button = (h: RouterTestingHarness, label: string) => Array.from(root(h).querySelectorAll('button')).find((b) => b.textContent?.includes(label));

  it('says which step it is, and counts the required ones for a category with four steps', async () => {
    const h = await open('k-seals', [definition({})]);

    expect(root(h).querySelector('rs-page-header')?.textContent).toContain('Paso 1 de 4 · Retenes y sellos · Identificación · requerido');
    expect(root(h).textContent).toContain('0 de 3 requeridos');
    expect(root(h).querySelectorAll('rs-stepper li, rs-stepper [role="listitem"]').length).toBeGreaterThan(0);
  });

  it('counts the specifications as done once the user is past them', async () => {
    const h = await open('k-seals', [definition({ required: false })]);
    expect(root(h).textContent).toContain('0 de 3 requeridos');

    goTo(h, 2);
    expect(root(h).textContent).toContain('1 de 3 requeridos');
  });

  it('hides the cost without the costs permission', async () => {
    const h = await open('k-seals', [definition({})]);
    goTo(h, 2);
    expect(root(h).querySelector('#wizard-cost')).toBeNull();
  });

  it('shows the cost with the costs permission', async () => {
    const h = await open('k-seals', [definition({})], ['inventory.costs.view']);
    goTo(h, 2);
    expect(root(h).querySelector('#wizard-cost')).not.toBeNull();
  });

  it('offers to omit an optional step, and not a required one', async () => {
    const h = await open('k-seals', [definition({})]);
    expect(button(h, 'Omitir este paso')).toBeUndefined();

    goTo(h, 3);
    expect(root(h).querySelector('rs-page-header')?.textContent).toContain('Paso 4 de 4');
    expect(button(h, 'Omitir este paso')).toBeDefined();
    expect(button(h, 'Crear producto')).toBeDefined();
  });

  it('gives bearings six steps, ending with the equivalences and "Guardar sin vincular"', async () => {
    const h = await open('k-bearings', [definition({ key: 'series', label: 'Serie', step: 2, required: false })]);
    expect(root(h).querySelector('rs-page-header')?.textContent).toContain('Paso 1 de 6 · Rodamientos');

    goTo(h, 5);
    expect(root(h).textContent).toContain('Revisa antes de guardar');
    expect(button(h, 'Guardar sin vincular')).toBeDefined();
    expect(button(h, 'Guardar producto')).toBeDefined();
  });

  it('asks the API for the code on "Siguiente" and stays on the first step when the code is taken', async () => {
    const h = await open('k-seals', [definition({})]);
    const page = h.routeDebugElement?.componentInstance as unknown as {
      form: { controls: { manufacturerCode: { setValue(v: string): void }; brandId: { setValue(v: string): void } } };
      next(): void;
    };
    page.form.controls.manufacturerCode.setValue('RT-3552');
    page.form.controls.brandId.setValue('b-skf');

    page.next();
    const request = http.expectOne((r) => r.url === '/api/v1/inventory/products/code-availability' && r.params.get('code') === 'RT-3552');
    expect(request.request.params.get('brandId')).toBe('b-skf');
    request.flush({ available: false, productId: 'p-9' });
    h.detectChanges();

    expect(root(h).querySelector('rs-page-header')?.textContent).toContain('Paso 1 de 4');
    expect(root(h).textContent).toContain('Ya existe un producto con este código para la marca.');
  });

  it('moves on when the API says the code is free', async () => {
    const h = await open('k-seals', [definition({ required: false })]);
    const page = h.routeDebugElement?.componentInstance as unknown as {
      form: { controls: { manufacturerCode: { setValue(v: string): void }; brandId: { setValue(v: string): void } } };
      next(): void;
    };
    page.form.controls.manufacturerCode.setValue('FREE-1');
    page.form.controls.brandId.setValue('b-skf');

    page.next();
    http.expectOne((r) => r.url === '/api/v1/inventory/products/code-availability').flush({ available: true, productId: null });
    h.detectChanges();

    expect(root(h).querySelector('rs-page-header')?.textContent).toContain('Paso 2 de 4');
  });

  it('asks before leaving when there is unsaved work', async () => {
    const h = await open('k-seals', [definition({})]);
    const input = root(h).querySelector<HTMLInputElement>('#wizard-code') as HTMLInputElement;
    input.value = 'RT-3552';
    input.dispatchEvent(new Event('input'));
    h.detectChanges();

    button(h, 'Cancelar')?.click();
    h.detectChanges();
    expect(root(h).textContent).toContain('¿Salir sin guardar?');
  });
});
