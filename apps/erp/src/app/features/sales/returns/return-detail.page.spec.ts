import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import type { SaleReturnDetail } from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { ReturnDetailPage } from './return-detail.page';

const URL = '/api/v1/sales/returns/r1';

const detail = (over: Partial<SaleReturnDetail> = {}): SaleReturnDetail => ({
  id: 'r1',
  number: 'DEV-000001',
  saleId: 's1',
  saleNumber: 'V-000231',
  customerName: 'Industrias Demo',
  customerDocumentNumber: '1020304050',
  pieces: 2,
  scrapPieces: 1,
  total: '200.00',
  status: 'APPROVED',
  creditNoteStatus: 'PENDING',
  createdAt: '2026-11-09T15:00:00.000Z',
  approvedAt: '2026-11-09T15:00:00.000Z',
  createdByName: 'Alberto Andia',
  reason: 'FACTORY_DEFECT',
  comment: null,
  refundMethod: 'CASH',
  refundReference: null,
  invoiceNumber: 1528,
  items: [
    { saleItemId: 'i1', productId: 'p1', productName: 'Rodamiento 6204', sku: 'RL-1', quantity: 1, condition: 'RESTOCK', refundAmount: '100.00' },
    { saleItemId: 'i1', productId: 'p1', productName: 'Rodamiento 6204', sku: 'RL-1', quantity: 1, condition: 'SCRAP', refundAmount: '100.00' },
  ],
  timeline: [
    { key: 'requested', state: 'done', at: '2026-11-09T15:00:00.000Z' },
    { key: 'approved', state: 'done', at: '2026-11-09T15:00:00.000Z' },
    { key: 'creditNote', state: 'current', at: null },
    { key: 'refunded', state: 'done', at: '2026-11-09T15:00:00.000Z' },
  ],
  audit: [{ action: 'sales.return.create', at: '2026-11-09T15:00:00.000Z', userName: 'Alberto Andia' }],
  approval: null,
  decision: null,
  ...over,
});

const pending = (): SaleReturnDetail =>
  detail({
    status: 'PENDING_APPROVAL',
    creditNoteStatus: null,
    approvedAt: null,
    approval: { id: 'a1', requestedBy: 'Alberto Andia', requestedAt: '2026-11-09T15:00:00.000Z', comment: 'Cliente frecuente' },
  });

describe('ReturnDetailPage', () => {
  let http: HttpTestingController;

  async function render(permissions: string[] = ['sales.returns.manage']) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(new Set(permissions)) },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'r1' }) } } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ReturnDetailPage);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }
  type Fixture = Awaited<ReturnType<typeof render>>;
  const el = (f: Fixture) => f.nativeElement as HTMLElement;
  const byId = (f: Fixture, id: string) => el(f).querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
  const settle = async (f: Fixture) => {
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
  };
  const type = (f: Fixture, text: string) => {
    const box = el(f).querySelector<HTMLTextAreaElement>('#return-reply')!;
    box.value = text;
    box.dispatchEvent(new Event('input'));
    f.detectChanges();
  };

  afterEach(() => http.verify());

  it('shows a skeleton while it loads', async () => {
    const f = await render();
    expect(el(f).querySelector('[aria-busy="true"]')).not.toBeNull();
    http.expectOne(URL).flush(detail());
  });

  it('shows the products with where each went, the timeline, the credit note and the refund', async () => {
    const f = await render();
    http.expectOne(URL).flush(detail());
    await settle(f);
    const t = el(f).textContent ?? '';
    expect(t).toContain('Devolución DEV-000001');
    expect(t).toContain('Venta V-000231');
    expect(t).toContain('A stock');
    expect(t).toContain('A merma');
    expect(t).toContain('Nota de crédito y débito · Pendiente');
    expect(t).toContain('Efectivo de caja');
    expect(t).toContain('Producto con falla de fábrica');
    expect(t).toContain('Devolución registrada y aprobada');
    expect(byId(f, 'return-approval')).toBeNull();
  });

  it('offers the decision only to who may approve, and only while it waits', async () => {
    const viewer = await render();
    http.expectOne(URL).flush(pending());
    await settle(viewer);
    expect(byId(viewer, 'return-approval')).toBeNull();
    expect(el(viewer).textContent).toContain('Pendiente: aprobación de Gerencia');
    TestBed.resetTestingModule();

    const approver = await render(['sales.returns.approve']);
    http.expectOne(URL).flush(pending());
    await settle(approver);
    expect(byId(approver, 'return-approval')).not.toBeNull();
    TestBed.resetTestingModule();

    const decided = await render(['sales.returns.approve']);
    http.expectOne(URL).flush(detail());
    await settle(decided);
    expect(byId(decided, 'return-approval')).toBeNull();
  });

  it('approves and shows the return as it ended', async () => {
    const f = await render(['sales.returns.approve']);
    http.expectOne(URL).flush(pending());
    await settle(f);
    byId(f, 'return-approve')!.click();
    const request = http.expectOne(`${URL}/approve`);
    expect(request.request.method).toBe('POST');
    request.flush(detail({ decision: { status: 'APPROVED', decidedBy: 'María Quispe', decidedAt: '2026-11-09T16:00:00.000Z', comment: '' } }));
    await settle(f);
    expect(byId(f, 'return-approval')).toBeNull();
    expect(byId(f, 'return-decision')).not.toBeNull();
  });

  it('needs the reply to reject, then sends it', async () => {
    const f = await render(['sales.returns.approve']);
    http.expectOne(URL).flush(pending());
    await settle(f);
    byId(f, 'return-reject')!.click();
    f.detectChanges();
    http.expectNone(`${URL}/reject`);
    expect(el(f).textContent).toContain('Escribe la respuesta');
    type(f, 'Fuera de garantía');
    byId(f, 'return-reject')!.click();
    const request = http.expectOne(`${URL}/reject`);
    expect(request.request.body).toEqual({ comment: 'Fuera de garantía' });
    request.flush(detail({ status: 'REJECTED', creditNoteStatus: null, approvedAt: null, decision: { status: 'REJECTED', decidedBy: 'María', decidedAt: '2026-11-09T16:00:00.000Z', comment: 'Fuera de garantía' } }));
    await settle(f);
    expect(el(f).textContent).toContain('Rechazada');
  });

  it('keeps the error and reloads when someone decided first', async () => {
    const f = await render(['sales.returns.approve']);
    http.expectOne(URL).flush(pending());
    await settle(f);
    byId(f, 'return-approve')!.click();
    http.expectOne(`${URL}/approve`).flush({ code: 'RETURN_NOT_PENDING', message: 'x' }, { status: 409, statusText: 'Conflict' });
    http.expectOne(URL).flush(detail());
    await settle(f);
    expect(byId(f, 'return-action-error')?.textContent).toContain('ya no espera una decisión');
  });

  it('shows the no-permission, gone and error states', async () => {
    const denied = await render();
    http.expectOne(URL).flush({ code: 'FORBIDDEN', message: 'x' }, { status: 403, statusText: 'Forbidden' });
    await settle(denied);
    expect(el(denied).textContent).toContain('No tienes permiso para ver esta devolución');
    TestBed.resetTestingModule();
    const gone = await render();
    http.expectOne(URL).flush({ code: 'RETURN_NOT_FOUND', message: 'x' }, { status: 404, statusText: 'Not Found' });
    await settle(gone);
    expect(el(gone).textContent).toContain('Esta devolución ya no existe');
    TestBed.resetTestingModule();
    const failed = await render();
    http.expectOne(URL).flush({ code: 'X', message: 'x' }, { status: 500, statusText: 'Error' });
    await settle(failed);
    expect(el(failed).textContent).toContain('No pudimos cargar la devolución');
  });
});
