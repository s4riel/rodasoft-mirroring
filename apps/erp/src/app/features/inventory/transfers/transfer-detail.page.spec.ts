import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { TransferDetail } from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { ContextStore } from '../../../core/context.store';
import { TransferDetailPage } from './transfer-detail.page';

const URL = '/api/v1/inventory/transfers/t1';

const detail = (over: Partial<TransferDetail> = {}): TransferDetail => ({
  id: 't1',
  number: 'TR-000123',
  status: 'IN_TRANSIT',
  origin: { id: 'w1', name: 'Almacén Central', branch: { id: 'b1', name: 'Central' } },
  destination: { id: 'w2', name: 'Almacén Norte', branch: { id: 'b2', name: 'Norte' } },
  note: 'Urgente',
  lines: [
    { productId: 'p1', sku: 'RL-1', manufacturerCode: '6204-2RS', name: 'Rodamiento', brand: 'SKF', quantity: 6, receivedQuantity: 2, surplusQuantity: 0, pendingQuantity: 4, available: 4, unitCost: '5.0000', status: 'OK' },
  ],
  summary: { products: 1, pieces: 6, value: '30.00', errors: 0, withoutCost: 0 },
  createdAt: '2026-10-28T15:00:00.000Z',
  updatedAt: '2026-10-28T16:00:00.000Z',
  sentAt: '2026-10-28T16:00:00.000Z',
  sentBy: 'Ana Pérez',
  receivedAt: null,
  receivedBy: null,
  receipts: [],
  adjustment: null,
  ...over,
});

@Component({ template: '' })
class StubPage {}

describe('TransferDetailPage', () => {
  let http: HttpTestingController;

  async function open(granted = ['inventory.transfers.create']) {
    const permissions = new Set(granted);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'inventory/transfers/:id', component: TransferDetailPage },
          { path: 'inventory/transfers/:id/edit', component: StubPage },
          { path: 'inventory/transfers', component: StubPage },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(permissions) },
        { provide: ContextStore, useValue: { can: (p: string) => permissions.has(p), branches: () => [] } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/inventory/transfers/t1', TransferDetailPage);
    return harness;
  }
  const text = (h: RouterTestingHarness) => (h.routeNativeElement as HTMLElement).textContent ?? '';
  async function settle(h: RouterTestingHarness) {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }

  afterEach(() => http.verify());

  it('shows the status, the route, the lines and the totals frozen when it was sent', async () => {
    const h = await open();
    http.expectOne(URL).flush(detail());
    await settle(h);
    expect(text(h)).toContain('Transferencia TR-000123');
    expect(text(h)).toContain('En tránsito');
    expect(text(h)).toContain('Central → Norte');
    expect(text(h)).toContain('Sucursal de origen');
    expect(text(h)).toContain('Sucursal de destino');
    expect(text(h)).toContain('1 producto distinto');
    expect(text(h)).toContain('6204-2RS');
    expect(text(h)).toContain('30,00');
  });

  it('shows who sent it, the pending pieces and the Recibir button to whoever can receive', async () => {
    const h = await open(['inventory.transfers.receive']);
    http.expectOne(URL).flush(detail());
    await settle(h);
    expect(text(h)).toContain('Por Ana Pérez');
    expect(text(h)).toContain('Esperando recepción en Norte');
    expect(text(h)).toContain('Pendiente');
    expect(text(h)).toContain('Recibir Productos');
  });

  it('hides Recibir without the receive permission', async () => {
    const h = await open(['inventory.transfers.create']);
    http.expectOne(URL).flush(detail());
    await settle(h);
    expect(text(h)).not.toContain('Recibir Productos');
  });

  it('shows the Enviada → En tránsito → Recibida tracker with the destination still pending', async () => {
    const h = await open();
    http.expectOne(URL).flush(detail());
    await settle(h);
    expect(text(h)).toContain('Enviada');
    expect(text(h)).toContain('Norte · pendiente');
    expect(text(h)).toContain('Esperando recepción en Norte');
  });

  it('searches the lines by code', async () => {
    const h = await open();
    http.expectOne(URL).flush(detail());
    await settle(h);
    const search = (h.routeNativeElement as HTMLElement).querySelector('#transfer-detail-search') as HTMLInputElement;
    search.value = 'zzz';
    search.dispatchEvent(new Event('input'));
    await settle(h);
    expect(text(h)).toContain('Ningún producto coincide');
  });

  it('shows the pending adjustment banner and the surplus column after the receipt is closed', async () => {
    const h = await open(['inventory.transfers.receive']);
    http.expectOne(URL).flush(
      detail({
        status: 'RECEIVED',
        receivedAt: '2026-10-29T10:00:00.000Z',
        receivedBy: 'Luis Rojas',
        adjustment: { id: 'a1', number: 'AJ-000007', status: 'PENDING_APPROVAL', totalValue: '10.00' },
        lines: [
          { productId: 'p1', sku: 'RL-1', manufacturerCode: '6204-2RS', name: 'Rodamiento', brand: 'SKF', quantity: 6, receivedQuantity: 6, surplusQuantity: 1, pendingQuantity: 0, available: 4, unitCost: '5.0000', status: 'OK' },
        ],
      }),
    );
    await settle(h);
    expect(text(h)).toContain('Ajuste pendiente AJ-000007');
    expect(text(h)).toContain('Sobrante');
    expect(text(h)).toContain('Norte · 29 oct 2026');
    expect(text(h)).not.toContain('Recibir Productos');
  });

  it('leaves the value out when the viewer cannot see costs', async () => {
    const h = await open();
    http.expectOne(URL).flush(detail({ summary: { products: 1, pieces: 6, value: null, errors: 0, withoutCost: null } }));
    await settle(h);
    expect(text(h)).not.toContain('Valor');
  });

  it('sends a draft to the editor instead of showing it', async () => {
    const h = await open();
    http.expectOne(URL).flush(detail({ status: 'DRAFT' }));
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/inventory/transfers/t1/edit');
  });

  it('says the transfer does not exist, with a retry', async () => {
    const h = await open();
    http.expectOne(URL).flush({ code: 'TRANSFER_NOT_FOUND', message: 'x' }, { status: 404, statusText: 'Not Found' });
    await settle(h);
    expect(text(h)).toContain('La transferencia ya no existe');
    expect(text(h)).toContain('Reintentar');
  });

  it('shows the no-permission state without calling the API', async () => {
    const h = await open([]);
    await settle(h);
    expect(text(h)).toContain('No tienes permiso para ver esta transferencia');
  });
  describe('cancelling the transfer', () => {
    const el = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
    const button = (h: RouterTestingHarness, name: string) =>
      Array.from(el(h).querySelectorAll('button')).find((b) => b.textContent?.trim() === name) as HTMLButtonElement;

    it('offers "Cancelar transferencia" only while it is in transit, to whoever can create transfers', async () => {
      const h = await open(['inventory.transfers.create']);
      http.expectOne(URL).flush(detail());
      await settle(h);
      expect(button(h, 'Cancelar transferencia')).toBeTruthy();
    });

    it('hides it once part of it was received, and without the create permission', async () => {
      const partial = await open(['inventory.transfers.create']);
      http.expectOne(URL).flush(detail({ status: 'PARTIALLY_RECEIVED' }));
      await settle(partial);
      expect(button(partial, 'Cancelar transferencia')).toBeUndefined();
      TestBed.resetTestingModule();

      const receiver = await open(['inventory.transfers.receive']);
      http.expectOne(URL).flush(detail());
      await settle(receiver);
      expect(button(receiver, 'Cancelar transferencia')).toBeUndefined();
    });

    it('asks first, then cancels, tells where the pieces went and shows the new status', async () => {
      const h = await open(['inventory.transfers.create']);
      http.expectOne(URL).flush(detail());
      await settle(h);
      button(h, 'Cancelar transferencia').click();
      await settle(h);
      expect(el(h).textContent).toContain('¿Cancelar la transferencia?');
      expect(el(h).textContent).toContain('volverán a Central');

      const confirm = Array.from(el(h).querySelectorAll('button')).filter((b) => b.textContent?.trim() === 'Cancelar transferencia').pop() as HTMLButtonElement;
      confirm.click();
      const req = http.expectOne(`${URL}/cancel`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ expectedUpdatedAt: '2026-10-28T16:00:00.000Z' });
      req.flush(detail({ status: 'CANCELLED' }));
      await settle(h);
      expect(el(h).textContent).toContain('Cancelada');
      expect(el(h).textContent).toContain('Las piezas volvieron a Central');
      expect(button(h, 'Cancelar transferencia')).toBeUndefined();
    });

    it('shows the Spanish message when the transfer changed meanwhile', async () => {
      const h = await open(['inventory.transfers.create']);
      http.expectOne(URL).flush(detail());
      await settle(h);
      button(h, 'Cancelar transferencia').click();
      await settle(h);
      const confirm = Array.from(el(h).querySelectorAll('button')).filter((b) => b.textContent?.trim() === 'Cancelar transferencia').pop() as HTMLButtonElement;
      confirm.click();
      http.expectOne(`${URL}/cancel`).flush({ code: 'TRANSFER_MODIFIED', message: 'x' }, { status: 409, statusText: 'Conflict' });
      await settle(h);
      expect(el(h).textContent).toContain('Otro usuario modificó esta transferencia');
    });
  });

  describe('receiving on the same view (IN-24b)', () => {
    const line = (productId: string, code: string, quantity: number, receivedQuantity = 0) => ({
      productId,
      sku: `RL-${code}`,
      manufacturerCode: code,
      name: `Rodamiento ${code}`,
      brand: 'SKF',
      quantity,
      receivedQuantity,
      surplusQuantity: 0,
      pendingQuantity: quantity - receivedQuantity,
      available: 0,
      unitCost: '5.0000',
      status: 'OK' as const,
    });
    const two = (over: Partial<TransferDetail> = {}) => detail({ lines: [line('pA', '6204-2RS', 10), line('pB', '6205-ZZ', 4)], ...over });

    const el = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
    const button = (h: RouterTestingHarness, name: string) =>
      Array.from(el(h).querySelectorAll('button')).find((b) => b.textContent?.trim().includes(name)) as HTMLButtonElement;
    const input = (h: RouterTestingHarness, code: string) => el(h).querySelector(`input[aria-label="Piezas recibidas de ${code}"]`) as HTMLInputElement;
    async function type(h: RouterTestingHarness, code: string, value: string) {
      const field = input(h, code);
      field.value = value;
      field.dispatchEvent(new Event('input'));
      await settle(h);
    }
    async function startReceiving(h: RouterTestingHarness) {
      http.expectOne(URL).flush(two());
      await settle(h);
      button(h, 'Recibir Productos').click();
      await settle(h);
    }

    it('"Recibir Productos" turns the Recibido column into inputs and shows Recibir todo in the bottom bar, without leaving the page', async () => {
      const h = await open(['inventory.transfers.receive']);
      await startReceiving(h);
      expect(TestBed.inject(Router).url).toBe('/inventory/transfers/t1');
      expect(input(h, '6204-2RS')).toBeTruthy();
      expect(input(h, '6205-ZZ')).toBeTruthy();
      for (const label of ['Recibir todo', 'Registrar recepción', 'Finalizar recepción', 'Cancelar']) expect(button(h, label)).toBeTruthy();
      expect(button(h, 'Recibir Productos')).toBeUndefined();
    });

    it('does not show inputs before the button is pressed', async () => {
      const h = await open(['inventory.transfers.receive']);
      http.expectOne(URL).flush(two());
      await settle(h);
      expect(input(h, '6204-2RS')).toBeNull();
      expect(button(h, 'Recibir todo')).toBeUndefined();
    });

    it('counts the pieces typed and "Recibir todo" counts every line', async () => {
      const h = await open(['inventory.transfers.receive']);
      await startReceiving(h);
      await type(h, '6204-2RS', '6');
      expect(el(h).textContent).toMatch(/Piezas recibidas ahora\s*6/);
      expect(el(h).textContent).toMatch(/Piezas pendientes\s*8/);
      button(h, 'Recibir todo').click();
      await settle(h);
      expect(el(h).textContent).toMatch(/Piezas recibidas ahora\s*14/);
      expect(el(h).textContent).toMatch(/Piezas pendientes\s*0/);
    });

    it('flags a count above what is pending and blocks the session', async () => {
      const h = await open(['inventory.transfers.receive']);
      await startReceiving(h);
      await type(h, '6205-ZZ', '5');
      expect(el(h).textContent).toContain('Supera lo pendiente');
      expect(button(h, 'Registrar recepción').disabled).toBe(true);
      expect(button(h, 'Finalizar recepción').disabled).toBe(true);
    });

    it('registers a partial session, shows the new received quantity and leaves receiving mode', async () => {
      const h = await open(['inventory.transfers.receive']);
      await startReceiving(h);
      await type(h, '6204-2RS', '6');
      button(h, 'Registrar recepción').click();
      const req = http.expectOne(`${URL}/receipts`);
      expect(req.request.body).toEqual({ lines: [{ productId: 'pA', quantity: 6 }], expectedUpdatedAt: '2026-10-28T16:00:00.000Z' });
      req.flush(two({ status: 'PARTIALLY_RECEIVED', updatedAt: '2026-10-28T17:00:00.000Z', lines: [line('pA', '6204-2RS', 10, 6), line('pB', '6205-ZZ', 4)] }));
      await settle(h);
      expect(TestBed.inject(Router).url).toBe('/inventory/transfers/t1');
      expect(input(h, '6204-2RS')).toBeNull();
      expect(el(h).textContent).toContain('Recepción registrada');
      expect(el(h).textContent).toContain('Recibida parcialmente');
      expect(button(h, 'Recibir Productos')).toBeTruthy();
    });

    it('finishing opens the differences and closing sends the final count with the surplus', async () => {
      const h = await open(['inventory.transfers.receive']);
      await startReceiving(h);
      await type(h, '6204-2RS', '8');
      button(h, 'Finalizar recepción').click();
      await settle(h);
      expect(el(h).textContent).toContain('Diferencias de la recepción');
      expect(el(h).textContent).toContain('Se generará un ajuste pendiente de aprobación');
      expect(el(h).textContent).toContain('Faltante');

      button(h, 'Confirmar').click();
      const req = http.expectOne(`${URL}/close`);
      expect(req.request.body).toEqual({ lines: [{ productId: 'pA', quantity: 8 }], surplus: [], expectedUpdatedAt: '2026-10-28T16:00:00.000Z' });
      req.flush(two({ status: 'RECEIVED', adjustment: { id: 'a1', number: 'AJ-000007', status: 'PENDING_APPROVAL', totalValue: '30.00' } }));
      await settle(h);
      expect(TestBed.inject(Router).url).toBe('/inventory/transfers/t1');
      expect(el(h).textContent).toContain('Ajuste pendiente AJ-000007');
      expect(input(h, '6204-2RS')).toBeNull();
    });

    it('shows the Spanish message of an API error and keeps what was counted', async () => {
      const h = await open(['inventory.transfers.receive']);
      await startReceiving(h);
      await type(h, '6204-2RS', '6');
      button(h, 'Registrar recepción').click();
      http.expectOne(`${URL}/receipts`).flush({ code: 'TRANSFER_MODIFIED', message: 'x' }, { status: 409, statusText: 'Conflict' });
      await settle(h);
      expect(el(h).textContent).toContain('Otro usuario modificó esta transferencia');
      expect(input(h, '6204-2RS').value).toBe('6');
    });

    it('Cancelar leaves receiving mode and drops the counts', async () => {
      const h = await open(['inventory.transfers.receive']);
      await startReceiving(h);
      await type(h, '6204-2RS', '6');
      button(h, 'Cancelar').click();
      await settle(h);
      expect(input(h, '6204-2RS')).toBeNull();
      button(h, 'Recibir Productos').click();
      await settle(h);
      expect(input(h, '6204-2RS').value).toBe('');
    });
  });
});
