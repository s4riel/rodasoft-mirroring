import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import type { ProductMovementsResponse } from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { of } from 'rxjs';
import { ProductSheetStore } from '../product-sheet.store';
import { ProductMovementsTab } from './product-movements.tab';

const URL = '/api/v1/inventory/products/p1/movements?page=1&pageSize=10';

const RESPONSE: ProductMovementsResponse = {
  items: [
    {
      id: 'm1',
      date: '2026-10-22T14:05:00Z',
      type: 'SALE',
      document: { refType: 'SALE', refNumber: 'V-00231' },
      quantity: -4,
      balanceAfter: 6,
      branch: { id: 'b1', name: 'Sucursal Centro' },
      warehouse: { id: 'w1', name: 'Almacén principal' },
    },
  ],
  total: 1,
  page: 1,
  pageSize: 10,
  summary: { inLast30Days: 26, outLast30Days: 6, currentBalance: 27 },
};

describe('ProductMovementsTab', () => {
  let fixture: ComponentFixture<ProductMovementsTab>;
  let http: HttpTestingController;
  const granted = signal<ReadonlySet<string>>(new Set(['inventory.kardex.view']));

  beforeEach(() => {
    granted.set(new Set(['inventory.kardex.view']));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: granted },
        { provide: ProductSheetStore, useValue: { product: signal(null) } },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ id: 'p1' })), queryParamMap: of(convertToParamMap({})) },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ProductMovementsTab);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  it('shows a skeleton while loading', () => {
    expect(fixture.nativeElement.querySelector('[aria-busy="true"]')).not.toBeNull();
    http.expectOne((r) => r.urlWithParams === URL).flush(RESPONSE);
  });

  it('shows the KPIs and the signed movements', () => {
    http.expectOne((r) => r.urlWithParams === URL).flush(RESPONSE);
    fixture.detectChanges();
    expect(text()).toContain('+26');
    expect(text()).toContain('−6');
    expect(text()).toContain('27 uds');
    expect(text()).toContain('Venta V-00231');
    expect(text()).toContain('−4');
    expect(text()).toContain('Sucursal Centro');
  });

  it('links to the kardex of the product for those who may consult it', () => {
    http.expectOne((r) => r.urlWithParams === URL).flush(RESPONSE);
    fixture.detectChanges();
    const link = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>('a[href^="/inventory/kardex"]');
    expect(link?.textContent).toContain('Ver kardex');
    expect(link?.getAttribute('href')).toBe('/inventory/kardex?productId=p1');
  });

  it('hides the kardex link without inventory.kardex.view', () => {
    granted.set(new Set());
    http.expectOne((r) => r.urlWithParams === URL).flush(RESPONSE);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('a[href^="/inventory/kardex"]')).toBeNull();
  });

  it('shows the empty state when there are no movements', () => {
    http.expectOne((r) => r.urlWithParams === URL).flush({ ...RESPONSE, items: [], total: 0 });
    fixture.detectChanges();
    expect(text()).toContain('Sin movimientos registrados');
  });

  it('shows the error state and retries', () => {
    http.expectOne((r) => r.urlWithParams === URL).flush({ code: 'X', message: 'x' }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(text()).toContain('No pudimos cargar los movimientos');
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button')?.click();
    fixture.detectChanges();
    http.expectOne((r) => r.urlWithParams === URL).flush(RESPONSE);
  });

  it('shows the no-permission state on 403', () => {
    http.expectOne((r) => r.urlWithParams === URL).flush({ code: 'NO_PERMISSION', message: 'x' }, { status: 403, statusText: 'Forbidden' });
    fixture.detectChanges();
    expect(text()).toContain('No tienes permiso para ver el stock');
  });
});
