import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { BulkPricePreview } from '@rodasoft/domain';
import { RS_PERMISSIONS, SelectComponent, ToastService } from '@rodasoft/ui';
import { PriceBulkUpdatePage } from './price-bulk-update.page';
import { bulkPreview, priceList } from './prices.testing';

const LIST_URL = '/api/v1/sales/prices';
const PREVIEW_URL = '/api/v1/sales/prices/bulk/preview';
const APPLY_URL = '/api/v1/sales/prices/bulk/apply';

@Component({ template: '<p>list</p>' })
class PriceListStub {}

/** VP-11c · Actualización masiva de precios (HU-VEN-27). */
describe('PriceBulkUpdatePage', () => {
  let http: HttpTestingController;
  const toast = { success: jest.fn(), warning: jest.fn(), error: jest.fn(), toasts: () => [], dismiss: jest.fn() };

  async function open() {
    toast.success.mockClear();
    toast.warning.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'sales/prices/bulk', component: PriceBulkUpdatePage },
          { path: 'sales/prices', component: PriceListStub },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(new Set(['sales.prices.edit'])) },
        { provide: ToastService, useValue: toast },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/sales/prices/bulk', PriceBulkUpdatePage);
    return harness;
  }

  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  const text = (h: RouterTestingHarness) => root(h).textContent?.replace(/\s+/g, ' ') ?? '';
  const byId = (h: RouterTestingHarness, id: string) => root(h).querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const catalog = () => http.expectOne((r) => r.url === LIST_URL);
  const preview = () => http.expectOne(PREVIEW_URL);
  async function settle(h: RouterTestingHarness) {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }
  /** The preview waits 300 ms after the last change. */
  const afterDebounce = (h: RouterTestingHarness) => new Promise<void>((resolve) => setTimeout(resolve, 350)).then(() => settle(h));

  function select(h: RouterTestingHarness, testId: string): SelectComponent {
    return h.fixture.debugElement.queryAll(By.directive(SelectComponent)).find((s) => (s.nativeElement as HTMLElement).dataset['testid'] === testId)
      ?.componentInstance as SelectComponent;
  }
  async function type(h: RouterTestingHarness, value: string) {
    const input = byId(h, 'bulk-percent') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(h);
  }
  /** Brand chosen, 5 typed, and the preview answered: the screen ready to apply. */
  async function ready(over: Partial<BulkPreviewOver> = {}) {
    const h = await open();
    catalog().flush(priceList({ total: 142 }));
    await settle(h);
    select(h, 'bulk-brand').value.set('b1');
    await settle(h);
    catalog().flush(priceList({ total: 3 }));
    await type(h, '5');
    await afterDebounce(h);
    preview().flush(bulkPreview(over));
    await settle(h);
    return h;
  }
  type BulkPreviewOver = BulkPricePreview;
  const clickApply = async (h: RouterTestingHarness) => {
    (byId(h, 'bulk-apply') as HTMLButtonElement).click();
    await settle(h);
  };
  const confirm = async (h: RouterTestingHarness) => {
    (document.querySelector('[data-testid="bulk-confirm"]') as HTMLButtonElement).click();
    await settle(h);
  };

  afterEach(() => http.verify());

  it('opens with the three steps and nothing to apply, and asks only for the brands and categories', async () => {
    const h = await open();
    const req = catalog();
    expect(req.request.params.get('pageSize')).toBe('1');
    expect(req.request.params.has('brandId')).toBe(false);
    req.flush(priceList({ total: 142 }));
    await settle(h);
    expect(text(h)).toContain('Actualización masiva de precios');
    expect(text(h)).toContain('1. Qué productos');
    expect(text(h)).toContain('2. Cómo ajustar');
    expect(text(h)).toContain('3. Vista previa (0 de 0)');
    expect(byId(h, 'bulk-idle')).not.toBeNull();
    expect((byId(h, 'bulk-apply') as HTMLButtonElement).disabled).toBe(true);
    // no filter: the count is not shown, and no preview is asked
    expect(byId(h, 'bulk-match')).toBeNull();
    http.expectNone(PREVIEW_URL);
  });

  it('counts the products that match the filter as the user picks it', async () => {
    const h = await open();
    catalog().flush(priceList());
    await settle(h);
    select(h, 'bulk-brand').value.set('b1');
    await settle(h);
    const req = catalog();
    expect(req.request.params.get('brandId')).toBe('b1');
    req.flush(priceList({ total: 142 }));
    await settle(h);
    expect(byId(h, 'bulk-match')?.textContent).toContain('142 productos coinciden con el filtro');
  });

  it('has the two adjustments and the three roundings, with Aumentar and the rounding of the company chosen', async () => {
    const h = await open();
    catalog().flush(priceList());
    await settle(h);
    const selected = (id: string) => byId(h, id)?.querySelector('button')?.getAttribute('aria-pressed');
    expect(selected('bulk-direction-INCREASE')).toBe('true');
    expect(selected('bulk-direction-DECREASE')).toBe('false');
    expect(selected('bulk-rounding-NONE')).toBe('true');
    for (const label of ['Aumentar %', 'Rebajar %', 'Sin redondeo', 'A Bs 0,50', 'A Bs 1']) expect(text(h)).toContain(label);
  });

  it('asks for the preview once there is a filter and a valid percent, and shows what changes', async () => {
    const h = await open();
    catalog().flush(priceList());
    await settle(h);
    select(h, 'bulk-brand').value.set('b1');
    await settle(h);
    catalog().flush(priceList({ total: 3 }));
    await type(h, '5');
    await afterDebounce(h);
    const req = preview();
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ brandId: 'b1', direction: 'INCREASE', percent: '5.00', rounding: 'NONE', page: 1, pageSize: 20 });
    req.flush(bulkPreview());
    await settle(h);

    expect(byId(h, 'bulk-preview-title')?.textContent).toContain('3. Vista previa (2 de 3)');
    const rows = Array.from(root(h).querySelectorAll('rs-doc-table tbody tr')).map((r) => r.textContent?.replace(/\s+/g, ' ') ?? '');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('6205-2RS');
    expect(rows[0]).toContain('Bs 245,00');
    expect(rows[0]).toContain('Bs 257,25');
    expect(rows[0]).toContain('+5,0 %');
    expect(rows[2]).toContain('Sin cambio');
    expect(byId(h, 'bulk-skipped')?.textContent).toContain('1 con el mismo precio tras el ajuste');
    expect(byId(h, 'bulk-apply')?.textContent).toContain('Aplicar a 2 productos');
    expect((byId(h, 'bulk-apply') as HTMLButtonElement).disabled).toBe(false);
    expect(byId(h, 'bulk-warning-note')).not.toBeNull();
  });

  it('does not ask for a preview with a percent that is not valid, and says why', async () => {
    const h = await open();
    catalog().flush(priceList());
    await settle(h);
    select(h, 'bulk-brand').value.set('b1');
    await settle(h);
    catalog().flush(priceList({ total: 3 }));
    await type(h, '0');
    await afterDebounce(h);
    http.expectNone(PREVIEW_URL);
    expect(text(h)).toContain('Ingresa un porcentaje mayor que cero');
    expect((byId(h, 'bulk-apply') as HTMLButtonElement).disabled).toBe(true);
  });

  it('reads the preview again with the rounding of the company when the user has not picked one', async () => {
    const h = await open();
    catalog().flush(priceList());
    await settle(h);
    select(h, 'bulk-brand').value.set('b1');
    await settle(h);
    catalog().flush(priceList({ total: 3 }));
    await type(h, '5');
    await afterDebounce(h);
    preview().flush(bulkPreview({ defaultRounding: 'HALF_BOLIVIANO' }));
    await afterDebounce(h);
    const again = preview();
    expect(again.request.body).toMatchObject({ rounding: 'HALF_BOLIVIANO' });
    again.flush(bulkPreview({ defaultRounding: 'HALF_BOLIVIANO' }));
    await settle(h);
    expect(byId(h, 'bulk-rounding-HALF_BOLIVIANO')?.querySelector('button')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the rounding the user picked over the one of the company', async () => {
    const h = await ready();
    (byId(h, 'bulk-rounding-INTEGER')?.querySelector('button') as HTMLButtonElement).click();
    await afterDebounce(h);
    const req = preview();
    expect(req.request.body).toMatchObject({ rounding: 'INTEGER' });
    req.flush(bulkPreview({ defaultRounding: 'HALF_BOLIVIANO' }));
    await settle(h);
    expect(byId(h, 'bulk-rounding-INTEGER')?.querySelector('button')?.getAttribute('aria-pressed')).toBe('true');
    http.expectNone(PREVIEW_URL);
  });

  it('switches to a decrease and reads the preview again from page 1', async () => {
    const h = await ready();
    (byId(h, 'bulk-direction-DECREASE')?.querySelector('button') as HTMLButtonElement).click();
    await afterDebounce(h);
    const req = preview();
    expect(req.request.body).toMatchObject({ direction: 'DECREASE', page: 1 });
    req.flush(bulkPreview());
  });

  it('asks for the confirmation before applying, and applies the previewed batch with its hash and the reason', async () => {
    const h = await ready();
    await clickApply(h);
    expect(document.body.textContent).toContain('¿Aplicar el cambio de precios?');
    expect(document.querySelector('[data-testid="bulk-confirm-text"]')?.textContent).toContain('Se cambiará el precio de 2 productos');
    // nothing is sent until the user confirms
    http.expectNone(APPLY_URL);

    const reason = document.querySelector('#bulk-reason') as HTMLTextAreaElement;
    reason.value = '  Lista de abril  ';
    reason.dispatchEvent(new Event('input', { bubbles: true }));
    await confirm(h);

    const req = http.expectOne(APPLY_URL);
    expect(req.request.method).toBe('POST');
    // the batch only: the page of the table is not part of it
    expect(req.request.body).toEqual({ brandId: 'b1', direction: 'INCREASE', percent: '5.00', rounding: 'NONE', previewHash: 'hash-1', reason: 'Lista de abril' });
    req.flush({ batchId: 'batch-1', updated: 2 });
    await settle(h);
    expect(toast.success).toHaveBeenCalledWith('Se actualizaron los precios de 2 productos');
    expect(TestBed.inject(Router).url).toBe('/sales/prices');
  });

  it('reads the preview again, with a warning, when a price changed since the preview', async () => {
    const h = await ready();
    await clickApply(h);
    await confirm(h);
    http.expectOne(APPLY_URL).flush({ code: 'BULK_PREVIEW_STALE', message: 'x' }, { status: 409, statusText: 'Conflict' });
    await settle(h);
    expect(toast.warning).toHaveBeenCalledWith('Los precios cambiaron desde la vista previa. Revísala de nuevo antes de aplicar.');
    const again = preview();
    expect(again.request.body).toMatchObject({ brandId: 'b1', percent: '5.00' });
    again.flush(bulkPreview({ previewHash: 'hash-2' }));
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/sales/prices/bulk');
  });

  it('shows another apply error inside the confirmation and keeps the preview', async () => {
    const h = await ready();
    await clickApply(h);
    await confirm(h);
    http.expectOne(APPLY_URL).flush({ code: 'BULK_NOTHING_TO_CHANGE', message: 'x' }, { status: 409, statusText: 'Conflict' });
    await settle(h);
    expect(document.querySelector('[data-testid="bulk-apply-error"]')?.textContent).toContain('Ningún producto cambiaría de precio');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('blocks applying when the company asks for approval (decision #19)', async () => {
    const h = await ready({ requiresApproval: true });
    expect(byId(h, 'bulk-approval-note')?.textContent).toContain('requiere aprobación');
    expect(byId(h, 'bulk-warning-note')).toBeNull();
    expect((byId(h, 'bulk-apply') as HTMLButtonElement).disabled).toBe(true);
  });

  it('cannot apply when no product would change', async () => {
    const h = await ready({ counts: { matched: 1, toChange: 0, unchanged: 1, invalid: 0 }, items: [bulkPreview().items[2]] });
    expect((byId(h, 'bulk-apply') as HTMLButtonElement).disabled).toBe(true);
    expect(byId(h, 'bulk-apply')?.textContent).toContain('Aplicar a 0 productos');
  });

  it('says when no product matches the filter', async () => {
    const h = await ready({ counts: { matched: 0, toChange: 0, unchanged: 0, invalid: 0 }, items: [] });
    expect(text(h)).toContain('Ningún producto coincide');
  });

  it('offers to retry when the preview fails, and says so when the filter is too wide', async () => {
    const h = await open();
    catalog().flush(priceList());
    await settle(h);
    select(h, 'bulk-brand').value.set('b1');
    await settle(h);
    catalog().flush(priceList({ total: 9000 }));
    await type(h, '5');
    await afterDebounce(h);
    preview().flush({ code: 'BULK_TOO_MANY_PRODUCTS', message: 'x' }, { status: 400, statusText: 'Bad Request' });
    await settle(h);
    expect(text(h)).toContain('No pudimos calcular la vista previa');
    expect(text(h)).toContain('demasiados productos');

    const retry = Array.from(root(h).querySelectorAll('button')).find((b) => b.textContent?.includes('Reintentar')) as HTMLButtonElement;
    retry.click();
    await settle(h);
    preview().flush(bulkPreview());
    await settle(h);
    expect(byId(h, 'bulk-preview-title')?.textContent).toContain('(2 de 3)');
  });

  it('shows the no-access state when the preview is refused', async () => {
    const h = await open();
    catalog().flush(priceList());
    await settle(h);
    select(h, 'bulk-brand').value.set('b1');
    await settle(h);
    catalog().flush(priceList({ total: 3 }));
    await type(h, '5');
    await afterDebounce(h);
    preview().flush({ code: 'NO_PERMISSION', message: 'x' }, { status: 403, statusText: 'Forbidden' });
    await settle(h);
    expect(text(h)).toContain('No tienes permiso para cambiar precios');
  });

  it('goes back to the price list on Cancelar', async () => {
    const h = await open();
    catalog().flush(priceList());
    await settle(h);
    const cancel = Array.from(root(h).querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Cancelar') as HTMLButtonElement;
    cancel.click();
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/sales/prices');
  });

  it('shows the error of the brands and categories when they cannot be loaded', async () => {
    const h = await open();
    (catalog() as TestRequest).flush({ code: 'ERROR', message: 'boom' }, { status: 500, statusText: 'Server Error' });
    await settle(h);
    expect(text(h)).toContain('No pudimos cargar las marcas y categorías');
  });
});
