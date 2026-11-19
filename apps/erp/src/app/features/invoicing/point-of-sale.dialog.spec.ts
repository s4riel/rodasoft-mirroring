import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ContextStore } from '../../core/context.store';
import { PointOfSaleDialog } from './point-of-sale.dialog';

const CREATE = '/api/v1/invoicing/points-of-sale';

describe('PointOfSaleDialog (FS-33)', () => {
  let http: HttpTestingController;

  async function render() {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: ContextStore, useValue: { branches: () => [{ id: 'b1', name: 'Sucursal central' }] } }],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(PointOfSaleDialog);
    fixture.componentRef.setInput('types', [{ code: 5, description: 'Caja de sucursal' }]);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    // one branch: it is chosen and its warehouses are loaded
    http.expectOne((r) => r.url === '/api/v1/inventory/warehouses').flush({ items: [{ id: 'w1', name: 'Almacén central' }], total: 1, page: 1, pageSize: 100 });
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }
  type Fixture = Awaited<ReturnType<typeof render>>;
  const el = (f: Fixture) => f.nativeElement as HTMLElement;
  const save = (f: Fixture) => el(f).querySelector<HTMLButtonElement>('[data-testid="pos-save"]')!;
  const setName = (f: Fixture, text: string) => {
    const box = el(f).querySelector<HTMLInputElement>('#pos-name')!;
    box.value = text;
    box.dispatchEvent(new Event('input'));
    f.detectChanges();
  };
  const component = (f: Fixture) => f.componentInstance as unknown as { typeCode: { set(v: number): void } };

  afterEach(() => http.verify());

  it('asks for the name and the type before it registers anything', async () => {
    const f = await render();
    save(f).click();
    f.detectChanges();
    const text = el(f).textContent ?? '';
    expect(text).toContain('Escribe el nombre del punto de venta.');
    expect(text).toContain('Elige el tipo de punto de venta.');
  });

  it('registers the point in the SIAT with the branch, the type and the warehouse', async () => {
    const f = await render();
    const created = jest.fn();
    f.componentInstance.created.subscribe(created);
    setName(f, ' Caja 3 ');
    component(f).typeCode.set(5);
    save(f).click();
    const req = http.expectOne(CREATE);
    expect(req.request.body).toEqual({ branchId: 'b1', name: 'Caja 3', typeCode: 5, warehouseId: 'w1' });
    req.flush({});
    await f.whenStable();
    expect(created).toHaveBeenCalled();
    expect(f.componentInstance.open()).toBe(false);
  });

  it('says the SIAT does not answer and keeps the dialog open', async () => {
    const f = await render();
    setName(f, 'Caja 3');
    component(f).typeCode.set(5);
    save(f).click();
    http.expectOne(CREATE).flush({ code: 'SIAT_UNAVAILABLE', message: 'x' }, { status: 503, statusText: 'Service Unavailable' });
    await f.whenStable();
    f.detectChanges();
    expect(el(f).querySelector('[data-testid="pos-error"]')?.textContent).toContain('El SIAT no responde');
    expect(f.componentInstance.open()).toBe(true);
  });
});
