import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import type { ProductWarehouseStockResponse } from '@rodasoft/domain';
import { of } from 'rxjs';
import { ProductSheetStore } from '../product-sheet.store';
import { ProductStockTab } from './product-stock.tab';

const URL = '/api/v1/inventory/products/p1/stock';

const RESPONSE: ProductWarehouseStockResponse = {
  items: [
    {
      branch: { id: 'b1', name: 'Sucursal Centro' },
      warehouse: { id: 'w1', name: 'Almacén principal' },
      location: 'A-03-2',
      quantity: 6,
      inTransit: 4,
      minStock: 6,
      maxStock: 60,
      availability: 'low',
    },
    {
      branch: { id: 'b2', name: 'Sucursal Norte' },
      warehouse: { id: 'w2', name: 'Almacén norte' },
      location: null,
      quantity: 0,
      inTransit: 0,
      minStock: null,
      maxStock: null,
      availability: 'out',
    },
  ],
  total: 6,
};

describe('ProductStockTab', () => {
  let fixture: ComponentFixture<ProductStockTab>;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ProductSheetStore, useValue: { product: signal(null) } },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ id: 'p1' })), queryParamMap: of(convertToParamMap({})) },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ProductStockTab);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  it('shows the pieces in transit only for the warehouses that have some', () => {
    http.expectOne(URL).flush(RESPONSE);
    fixture.detectChanges();
    expect(text()).toContain('En tránsito: 4');
    expect(text().match(/En tránsito/g)).toHaveLength(1);
  });

  it('shows a row per warehouse with its flag, thresholds and the total', () => {
    http.expectOne(URL).flush(RESPONSE);
    fixture.detectChanges();
    expect(text()).toContain('Almacén principal');
    expect(text()).toContain('A-03-2');
    expect(fixture.nativeElement.querySelector('rs-stock-flag[aria-label="Stock bajo"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('rs-stock-flag[aria-label="Agotado"]')).not.toBeNull();
    expect(text()).toContain('Total 6 uds');
    expect(text()).toContain('el stock se mueve entre sucursales solo con transferencias.');
  });

  it('shows the empty state without warehouses', () => {
    http.expectOne(URL).flush({ items: [], total: 0 });
    fixture.detectChanges();
    expect(text()).toContain('Sin stock registrado');
  });

  it('shows the error state and retries', () => {
    http.expectOne(URL).flush({ code: 'X', message: 'x' }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(text()).toContain('No pudimos cargar el stock');
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button')?.click();
    fixture.detectChanges();
    http.expectOne(URL).flush(RESPONSE);
  });

  it('shows the no-permission state on 403', () => {
    http.expectOne(URL).flush({ code: 'NO_PERMISSION', message: 'x' }, { status: 403, statusText: 'Forbidden' });
    fixture.detectChanges();
    expect(text()).toContain('No tienes permiso para ver el stock');
  });
});
