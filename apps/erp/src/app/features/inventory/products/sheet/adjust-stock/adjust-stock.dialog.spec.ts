import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ProductWarehouseStockResponse, QuickAdjustmentResponse } from '@rodasoft/domain';
import { ToastService } from '@rodasoft/ui';
import { ContextStore } from '../../../../../core/context.store';
import { AdjustStockDialog } from './adjust-stock.dialog';

const STOCK_URL = '/api/v1/inventory/products/p1/stock';
const ADJUST_URL = '/api/v1/inventory/products/p1/stock-adjustments';

const BRANCHES = [
  {
    id: 'b1',
    code: 0,
    name: 'Huayna Kapac',
    warehouses: [
      { id: 'w1', code: 'W1', name: 'Principal' },
      { id: 'w2', code: 'W2', name: 'Anexo' },
    ],
  },
  { id: 'b2', code: 1, name: 'Sacaba', warehouses: [{ id: 'w3', code: 'W3', name: 'Principal' }] },
];

/** Stock of warehouse id → [quantity, minimum]. */
const stockOf = (...rows: [string, number, number?][]): ProductWarehouseStockResponse => ({
  items: rows.map(([id, quantity, minStock]) => ({
    branch: { id: 'b', name: 'B' },
    warehouse: { id, name: id },
    location: null,
    quantity,
    inTransit: 0,
    minStock: minStock ?? null,
    maxStock: null,
    availability: 'available' as const,
  })),
  total: rows.reduce((sum, [, q]) => sum + q, 0),
});

@Component({
  imports: [AdjustStockDialog],
  template: `<rs-adjust-stock-dialog [(open)]="open" [product]="product()" (adjusted)="adjusted.set($event)" />`,
})
class HostComponent {
  readonly open = signal(true);
  readonly product = signal<{ id: string; manufacturerCode: string; unit: string; brand: { name: string } } | null>({
    id: 'p1',
    manufacturerCode: '6205-2RS',
    unit: 'UN',
    brand: { name: 'SKF' },
  });
  readonly adjusted = signal<QuickAdjustmentResponse | null>(null);
}

describe('AdjustStockDialog', () => {
  let http: HttpTestingController;

  function configure(branches = BRANCHES) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ContextStore, useValue: { branches: () => branches, currentBranch: () => null } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  }

  async function setup(stock: ProductWarehouseStockResponse | 'fail' = stockOf(['w1', 20, 6], ['w2', 4], ['w3', 24, 6])) {
    configure();
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const req = http.expectOne(STOCK_URL);
    if (stock === 'fail') req.flush({ code: 'ERROR', message: 'x' }, { status: 500, statusText: 'Server Error' });
    else req.flush(stock);
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const button = (label: string) =>
      Array.from(el.querySelectorAll('[role=dialog] button')).find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
    const pick = async (id: string, label: string) => {
      (el.querySelector(`#${id}`) as HTMLButtonElement).click();
      await settle();
      const option = Array.from(el.querySelectorAll('[role=option]')).find((o) => o.textContent?.trim() === label) as HTMLElement;
      option.click();
      await settle();
    };
    const chip = async (label: string) => {
      const found = Array.from(el.querySelectorAll('rs-filter-chip button')).find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
      found.click();
      await settle();
    };
    const type = async (id: string, value: string) => {
      const input = el.querySelector(`#${id}`) as HTMLInputElement | HTMLTextAreaElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await settle();
    };
    const note = () => el.querySelector('rs-note[type=info]') ?? el.querySelector('rs-note');
    /** A complete, valid form: Sacaba (24 in stock, min 6), Salida 3, Merma. */
    const fill = async () => {
      await pick('adjust-branch', 'Sacaba');
      await chip('Salida');
      await type('adjust-quantity', '3');
      await pick('adjust-reason', 'Merma');
    };
    return { fixture, el, host: fixture.componentInstance, settle, button, pick, chip, type, fill, note };
  }

  afterEach(() => http.verify());

  it('shows the product and brand, then the stock of the chosen branch in the header', async () => {
    const { el, pick } = await setup();
    expect(el.querySelector('.subtitle')?.textContent).toBe('6205-2RS · SKF');
    await pick('adjust-branch', 'Sacaba');
    expect(el.querySelector('.subtitle')?.textContent).toBe('6205-2RS · SKF · Stock actual 24 en Sacaba');
  });

  it('offers the three kinds of adjustment as chips and lets one be chosen and cleared', async () => {
    const { el, chip } = await setup();
    const labels = () => Array.from(el.querySelectorAll('rs-filter-chip button')).map((b) => b.textContent?.trim());
    expect(labels()).toEqual(['Entrada', 'Salida', 'Corrección de conteo']);
    const pressed = () => Array.from(el.querySelectorAll('rs-filter-chip button[aria-pressed=true]')).map((b) => b.textContent?.trim());
    await chip('Salida');
    expect(pressed()).toEqual(['Salida']);
    await chip('Entrada');
    expect(pressed()).toEqual(['Entrada']);
    await chip('Entrada');
    expect(pressed()).toEqual([]);
  });

  it('asks which warehouse only when the branch has several', async () => {
    const { el, pick } = await setup();
    await pick('adjust-branch', 'Sacaba');
    expect(el.querySelector('#adjust-warehouse')).toBeNull();
    await pick('adjust-branch', 'Huayna Kapac');
    expect(el.querySelector('#adjust-warehouse')).not.toBeNull();
    await pick('adjust-warehouse', 'Anexo');
    expect(el.querySelector('.subtitle')?.textContent).toContain('Stock actual 24 en Huayna Kapac');
  });

  it('keeps Confirmar ajuste disabled until branch, kind, quantity and reason are set', async () => {
    const { button, pick, chip, type } = await setup();
    expect(button('Confirmar ajuste').disabled).toBe(true);
    await pick('adjust-branch', 'Sacaba');
    await chip('Salida');
    await type('adjust-quantity', '3');
    expect(button('Confirmar ajuste').disabled).toBe(true);
    await pick('adjust-reason', 'Merma');
    expect(button('Confirmar ajuste').disabled).toBe(false);
    await type('adjust-quantity', '0');
    expect(button('Confirmar ajuste').disabled).toBe(true);
  });

  it('shows the resulting stock against the minimum for an outward and an inward adjustment', async () => {
    const { el, pick, chip, type, note } = await setup();
    await pick('adjust-branch', 'Sacaba');
    await chip('Salida');
    await type('adjust-quantity', '3');
    expect(note()?.textContent).toContain('Stock resultante: 21 piezas');
    expect(note()?.textContent).toContain('24 − 3. Superior al mínimo de 6. Los ajustes grandes requieren aprobación.');
    await type('adjust-quantity', '18');
    expect(note()?.textContent).toContain('Stock resultante: 6 piezas');
    expect(note()?.textContent).toContain('Igual al mínimo de 6.');
    await type('adjust-quantity', '20');
    expect(note()?.textContent).toContain('Inferior al mínimo de 6.');
    await chip('Entrada');
    await type('adjust-quantity', '2');
    expect(note()?.textContent).toContain('Stock resultante: 26 piezas');
    expect(note()?.textContent).toContain('24 + 2.');
    expect(el.querySelector('rs-note')).not.toBeNull();
  });

  it('names the resulting stock with the unit of the product', async () => {
    const { host, pick, chip, type, note } = await setup();
    host.product.set({ id: 'p1', manufacturerCode: 'PAR-1', unit: 'PAR', brand: { name: 'SKF' } });
    await pick('adjust-branch', 'Sacaba');
    await chip('Salida');
    await type('adjust-quantity', '23');
    expect(note()?.textContent).toContain('Stock resultante: 1 par');
    await type('adjust-quantity', '3');
    expect(note()?.textContent).toContain('Stock resultante: 21 pares');
  });

  it('treats "Corrección de conteo" as the counted stock and shows the difference', async () => {
    const { el, button, pick, chip, type, note } = await setup();
    await pick('adjust-branch', 'Sacaba');
    await chip('Corrección de conteo');
    expect(el.textContent).toContain('Cantidad contada');
    await type('adjust-quantity', '20');
    expect(note()?.textContent).toContain('Stock resultante: 20 piezas');
    expect(note()?.textContent).toContain('24 → 20 (−4).');
    await pick('adjust-reason', 'Error de conteo');
    expect(button('Confirmar ajuste').disabled).toBe(false);
    await type('adjust-quantity', '24');
    expect(el.textContent).toContain('El conteo es igual al stock actual: no hay nada que ajustar.');
    expect(button('Confirmar ajuste').disabled).toBe(true);
    await type('adjust-quantity', '0');
    expect(button('Confirmar ajuste').disabled).toBe(false);
  });

  it('flags an outward quantity above the stock before sending', async () => {
    const { el, button, fill, type } = await setup();
    await fill();
    await type('adjust-quantity', '30');
    expect(el.textContent).toContain('No hay stock suficiente en el almacén para esta salida.');
    expect(button('Confirmar ajuste').disabled).toBe(true);
  });

  it('requires a comment for "Otro"', async () => {
    const { el, button, fill, pick, type } = await setup();
    await fill();
    await pick('adjust-reason', 'Otro');
    expect(button('Confirmar ajuste').disabled).toBe(true);
    expect(el.textContent).toContain('Describe el motivo cuando eliges "Otro".');
    await type('adjust-note', 'regalo a un cliente');
    expect(button('Confirmar ajuste').disabled).toBe(false);
  });

  it('sends the adjustment with the balance it saw, closes, reports it and emits the result', async () => {
    const { fixture, el, host, button, fill, type, settle } = await setup();
    await fill();
    await type('adjust-note', ' caja mojada ');

    button('Confirmar ajuste').click();
    const req = http.expectOne(ADJUST_URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      warehouseId: 'w3',
      kind: 'OUT',
      quantity: 3,
      reason: 'SHRINKAGE',
      note: 'caja mojada',
      expectedBalance: 24,
    });
    const body: QuickAdjustmentResponse = { movementId: 'm1', refNumber: 'AJ-000123', balanceAfter: 21, totalStock: 45 };
    req.flush(body);
    await settle();
    await fixture.whenStable();

    expect(host.open()).toBe(false);
    expect(host.adjusted()).toEqual(body);
    expect(el.querySelector('[role=dialog]')).toBeNull();
    expect(TestBed.inject(ToastService).toasts().map((t) => t.message)).toContain('Ajuste AJ-000123 registrado');
  });

  it('sends a count as the counted quantity', async () => {
    const { button, pick, chip, type, settle } = await setup();
    await pick('adjust-branch', 'Sacaba');
    await chip('Corrección de conteo');
    await type('adjust-quantity', '20');
    await pick('adjust-reason', 'Error de conteo');
    button('Confirmar ajuste').click();
    await settle();
    const req = http.expectOne(ADJUST_URL);
    expect(req.request.body).toMatchObject({ warehouseId: 'w3', kind: 'COUNT', quantity: 20, expectedBalance: 24 });
    req.flush({ movementId: 'm1', refNumber: 'AJ-000124', balanceAfter: 20, totalStock: 44 });
  });

  it('sends one request while saving and blocks Cancelar', async () => {
    const { host, button, fill, settle } = await setup();
    await fill();
    button('Confirmar ajuste').click();
    await settle();
    button('Confirmar ajuste').click();
    expect(button('Cancelar').disabled).toBe(true);
    http.expectOne(ADJUST_URL);
    expect(host.open()).toBe(true);
  });

  it('does not call the API when cancelled', async () => {
    const { button, host, settle } = await setup();
    button('Cancelar').click();
    await settle();
    expect(host.open()).toBe(false);
    http.expectNone(ADJUST_URL);
  });

  it('shows INSUFFICIENT_STOCK inline on the quantity and stays open', async () => {
    const { el, host, button, fill, settle } = await setup();
    await fill();
    button('Confirmar ajuste').click();
    http
      .expectOne(ADJUST_URL)
      .flush({ code: 'INSUFFICIENT_STOCK', message: 'x' }, { status: 422, statusText: 'Unprocessable Entity' });
    await settle();
    expect(host.open()).toBe(true);
    expect(el.querySelector('rs-field[forid=adjust-quantity]')?.textContent).toContain('No hay stock suficiente');
  });

  it('refreshes the stock and warns when STOCK_CHANGED', async () => {
    const { el, button, fill, settle, note } = await setup();
    await fill();
    button('Confirmar ajuste').click();
    http.expectOne(ADJUST_URL).flush({ code: 'STOCK_CHANGED', message: 'x' }, { status: 409, statusText: 'Conflict' });
    http.expectOne(STOCK_URL).flush(stockOf(['w3', 9, 6]));
    await settle();
    expect(el.textContent).toContain('El stock cambió mientras ajustabas.');
    expect(note()?.textContent).toBeTruthy();
    expect(el.textContent).toContain('Stock resultante: 6 piezas');
  });

  it('explains the approval limit when ADJUSTMENT_NEEDS_APPROVAL', async () => {
    const { el, button, fill, settle } = await setup();
    await fill();
    button('Confirmar ajuste').click();
    http
      .expectOne(ADJUST_URL)
      .flush({ code: 'ADJUSTMENT_NEEDS_APPROVAL', message: 'x' }, { status: 422, statusText: 'Unprocessable Entity' });
    await settle();
    expect(el.textContent).toContain('supera el límite sin aprobación');
  });

  it('adjusts without the resulting stock or an expected balance when the stock could not be read', async () => {
    const { el, button, fill, settle } = await setup('fail');
    expect(el.textContent).toContain('No pudimos leer el stock actual');
    await fill();
    expect(el.textContent).not.toContain('Stock resultante');
    button('Confirmar ajuste').click();
    const req = http.expectOne(ADJUST_URL);
    expect(req.request.body).not.toHaveProperty('expectedBalance');
    req.flush({ movementId: 'm1', refNumber: 'AJ-000001', balanceAfter: 0, totalStock: 0 });
    await settle();
  });

  it('retries reading the stock and shows the result once it arrives', async () => {
    const { el, button, pick, chip, type, settle } = await setup('fail');
    button('Reintentar').click();
    await settle();
    http.expectOne(STOCK_URL).flush(stockOf(['w3', 12, 6]));
    await settle();
    await pick('adjust-branch', 'Sacaba');
    await chip('Salida');
    await type('adjust-quantity', '2');
    expect(el.textContent).toContain('Stock resultante: 10 piezas');
    expect(el.textContent).not.toContain('No pudimos leer el stock actual');
  });

  it('shows a skeleton while the stock is loading', async () => {
    configure();
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('rs-skeleton')).not.toBeNull();
    http.expectOne(STOCK_URL).flush(stockOf(['w3', 12]));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('rs-skeleton')).toBeNull();
  });

  it('starts on the only branch when the member has one', async () => {
    configure([BRANCHES[1]]);
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    http.expectOne(STOCK_URL).flush(stockOf(['w3', 24, 6]));
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.subtitle')?.textContent).toContain('Stock actual 24 en Sacaba');
  });
});
