import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { HomologationRow } from '@rodasoft/domain';
import { HomologationProductDialog } from './homologation-product.dialog';

const URL = '/api/v1/invoicing/homologation/products/r1';

const product: HomologationRow = { id: 'r1', sku: 'RL-000001', code: '6205', name: 'Rodamiento', brand: 'SKF', sinProductCode: null, sinActivityCode: null, sinUnitCode: null, sinDescription: null, status: 'PENDING' };

describe('HomologationProductDialog', () => {
  let http: HttpTestingController;

  async function render() {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(HomologationProductDialog);
    fixture.componentRef.setInput('product', product);
    fixture.componentRef.setInput('units', [{ code: 58, description: 'UNIDAD (BIENES)' }]);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }
  type Fixture = Awaited<ReturnType<typeof render>>;
  const el = (f: Fixture) => f.nativeElement as HTMLElement;
  const save = (f: Fixture) => el(f).querySelector<HTMLButtonElement>('[data-testid="homologation-save"]')!;
  const type = (f: Fixture, text: string) => {
    const box = el(f).querySelector<HTMLInputElement>('#sin-code')!;
    box.value = text;
    box.dispatchEvent(new Event('input'));
    f.detectChanges();
  };

  afterEach(() => http.verify());

  it('asks for the code', async () => {
    const f = await render();
    save(f).click();
    f.detectChanges();
    expect(el(f).textContent).toContain('Escribe el código del catálogo del SIN.');
  });

  it('saves the code and tells the screen', async () => {
    const f = await render();
    const saved = jest.fn();
    f.componentInstance.saved.subscribe(saved);
    type(f, ' 84821 ');
    save(f).click();
    const req = http.expectOne(URL);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ sinProductCode: '84821', sinUnitCode: null });
    req.flush({});
    await f.whenStable();
    expect(saved).toHaveBeenCalled();
    expect(f.componentInstance.open()).toBe(false);
  });

  it('says an unknown code is not in the catalogue and stays open', async () => {
    const f = await render();
    type(f, '00000');
    save(f).click();
    http.expectOne(URL).flush({ code: 'SIN_CODE_UNKNOWN', message: 'x' }, { status: 409, statusText: 'Conflict' });
    await f.whenStable();
    f.detectChanges();
    expect(el(f).querySelector('[data-testid="homologation-error"]')?.textContent).toContain('no está en el catálogo sincronizado');
    expect(f.componentInstance.open()).toBe(true);
  });
});
