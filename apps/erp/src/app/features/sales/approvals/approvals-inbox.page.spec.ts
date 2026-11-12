import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { ApprovalInboxResponse } from '@rodasoft/domain';
import { RS_PERMISSIONS, ToastService } from '@rodasoft/ui';
import { ApprovalsCountStore } from './approvals-count.store';
import { ApprovalsInboxPage } from './approvals-inbox.page';
import { ALL_ITEMS, approvalInbox, approvalItem, EXPENSE_ITEM, RETURN_ITEM } from './approvals.testing';

const LIST_URL = '/api/v1/sales/approvals';

/** VP-25 · Aprobaciones (HU-VEN-29). */
describe('ApprovalsInboxPage', () => {
  let http: HttpTestingController;
  const toast = { success: jest.fn(), warning: jest.fn(), error: jest.fn(), toasts: () => [], dismiss: jest.fn() };

  async function open() {
    toast.success.mockClear();
    toast.warning.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'approvals', component: ApprovalsInboxPage }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(new Set(['sales.returns.approve'])) },
        { provide: ToastService, useValue: toast },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/approvals', ApprovalsInboxPage);
    return harness;
  }

  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  const text = (h: RouterTestingHarness) => root(h).textContent?.replace(/\s+/g, ' ') ?? '';
  const byId = (h: RouterTestingHarness, id: string) => root(h).querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const list = () => http.expectOne(LIST_URL);
  async function settle(h: RouterTestingHarness) {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }
  async function loaded(body: ApprovalInboxResponse = approvalInbox()) {
    const h = await open();
    list().flush(body);
    await settle(h);
    return h;
  }
  const click = async (h: RouterTestingHarness, id: string) => {
    (byId(h, id) as HTMLElement).click();
    await settle(h);
  };
  const chip = (h: RouterTestingHarness, type: string) => byId(h, `approvals-chip-${type}`)?.querySelector('button') as HTMLButtonElement;

  afterEach(() => http.verify());

  it('shows a skeleton while the inbox loads and asks for everything', async () => {
    const h = await open();
    h.detectChanges();
    expect(root(h).querySelector('[aria-busy="true"]')).not.toBeNull();
    const req = list();
    expect(req.request.params.has('type')).toBe(false);
    req.flush(approvalInbox());
  });

  it('shows the title and the four KPIs', async () => {
    const h = await loaded();
    expect(text(h)).toContain('Aprobaciones');
    expect(byId(h, 'approvals-pending')?.textContent).toContain('4');
    expect(byId(h, 'approvals-oldest')?.textContent).toContain('hace 5 h');
    expect(byId(h, 'approvals-approved')?.textContent).toContain('2');
    expect(byId(h, 'approvals-rejected')?.textContent).toContain('1');
    const labels = Array.from(root(h).querySelectorAll('rs-kpi-card')).map((k) => k.querySelector('.label')?.textContent);
    expect(labels).toEqual(['Pendientes', 'Más antigua', 'Aprobadas hoy', 'Rechazadas hoy']);
  });

  it('draws a section per type with its count, and the requests of each', async () => {
    const h = await loaded();
    for (const [type, heading] of [
      ['CANCELLATION', 'Anulaciones'],
      ['CASH_DIFFERENCE', 'Diferencias de caja'],
      ['RETURN', 'Devoluciones'],
      ['CASH_EXPENSE', 'Gastos de caja'],
    ]) {
      const section = byId(h, `approvals-group-${type}`);
      expect(section?.querySelector('h2')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(`${heading} 1`);
      expect(section?.querySelectorAll('rs-request-card')).toHaveLength(1);
    }
    const card = byId(h, 'approval-r-return');
    expect(card?.textContent).toContain('Devolución');
    expect(card?.textContent).toContain('DEV-000012 · venta V-000231 · Minera Demo Ltda.');
    expect(card?.textContent).toContain('Ana Cajera · Producto con falla de fábrica · 2 piezas · hace 3 horas');
    expect(card?.textContent).toContain('“El cliente trajo el rodamiento roto”');
    expect(card?.textContent).toContain('−Bs 200,00');
  });

  it('leaves out the sections that have nothing waiting', async () => {
    const h = await loaded(approvalInbox({}, [RETURN_ITEM]));
    expect(byId(h, 'approvals-group-RETURN')).not.toBeNull();
    expect(byId(h, 'approvals-group-CANCELLATION')).toBeNull();
    expect(byId(h, 'approvals-group-CASH_EXPENSE')).toBeNull();
  });

  it('has a chip per type the caller may decide, with its count, and filters by it', async () => {
    const h = await loaded();
    const labels = ['all', 'CANCELLATION', 'CASH_DIFFERENCE', 'RETURN', 'CASH_EXPENSE'].map((key) => byId(h, `approvals-chip-${key}`)?.textContent?.replace(/\s+/g, ' ').trim());
    expect(labels).toEqual(['Todas (4)', 'Anulaciones (1)', 'Diferencias de caja (1)', 'Devoluciones (1)', 'Gastos de caja (1)']);
    expect(chip(h, 'all').getAttribute('aria-pressed')).toBe('true');

    chip(h, 'RETURN').click();
    await settle(h);
    expect(byId(h, 'approvals-group-RETURN')).not.toBeNull();
    expect(byId(h, 'approvals-group-CANCELLATION')).toBeNull();
    expect(chip(h, 'RETURN').getAttribute('aria-pressed')).toBe('true');
    expect(chip(h, 'all').getAttribute('aria-pressed')).toBe('false');
    // choosing a chip is a filter of what was read: no new request
    chip(h, 'all').click();
    await settle(h);
    expect(byId(h, 'approvals-group-CANCELLATION')).not.toBeNull();
  });

  it('offers only the types the API sent', async () => {
    const h = await loaded(approvalInbox({}, [ALL_ITEMS[1]], ['CASH_DIFFERENCE']));
    expect(byId(h, 'approvals-chip-CASH_DIFFERENCE')).not.toBeNull();
    expect(byId(h, 'approvals-chip-RETURN')).toBeNull();
    expect(byId(h, 'approvals-group-RETURN')).toBeNull();
  });

  it('approves and rejects returns and cash expenses in place, and only those', async () => {
    const h = await loaded();
    expect(byId(h, 'approval-approve-r-return')).not.toBeNull();
    expect(byId(h, 'approval-reject-r-return')).not.toBeNull();
    expect(byId(h, 'approval-approve-r-expense')).not.toBeNull();
    expect(byId(h, 'approval-approve-r-cancel')).toBeNull();
    expect(byId(h, 'approval-reject-r-cancel')).toBeNull();
    expect(byId(h, 'approval-approve-r-diff')).toBeNull();
  });

  it('sends every request to its review page with "Ver detalle"', async () => {
    const h = await loaded();
    const href = (id: string) => byId(h, `approval-detail-${id}`)?.getAttribute('href');
    expect(href('r-cancel')).toBe('/sales/history/sale1/cancellation');
    expect(href('r-diff')).toBe('/sales/cash-register/shifts/shift1/review');
    expect(href('r-return')).toBe('/sales/returns/ret1');
    expect(href('r-expense')).toBe('/sales/cash-register/movements/mov1');
  });

  it('does not offer to decide what the caller may not decide', async () => {
    const h = await loaded(approvalInbox({}, [approvalItem({ canDecide: false })]));
    expect(byId(h, 'approval-approve-r1')).toBeNull();
    expect(byId(h, 'approval-detail-r1')).not.toBeNull();
  });

  it('approves a return: the dialog, the decision through the return endpoint, and the list read again without it', async () => {
    const h = await loaded();
    const store = TestBed.inject(ApprovalsCountStore);
    expect(store.pending()).toBe(4);
    await click(h, 'approval-approve-r-return');
    expect(text(h)).toContain('Aprobar devolución');
    (byId(h, 'decision-confirm') as HTMLButtonElement).click();
    await settle(h);

    const decision = http.expectOne('/api/v1/sales/returns/ret1/approve');
    expect(decision.request.method).toBe('POST');
    decision.flush({});
    await settle(h);

    const again = list();
    again.flush(approvalInbox({}, ALL_ITEMS.filter((item) => item.id !== 'r-return')));
    await settle(h);
    expect(byId(h, 'approval-r-return')).toBeNull();
    expect(byId(h, 'approvals-group-RETURN')).toBeNull();
    expect(byId(h, 'approvals-pending')?.textContent).toContain('3');
    // the badge of the tab follows
    expect(store.pending()).toBe(3);
    expect(toast.success).toHaveBeenCalledWith('Solicitud aprobada');
  });

  it('rejects a cash expense only with a comment', async () => {
    const h = await loaded();
    await click(h, 'approval-reject-r-expense');
    expect(text(h)).toContain('Rechazar gasto de caja');
    (byId(h, 'decision-confirm') as HTMLButtonElement).click();
    await settle(h);
    http.expectNone('/api/v1/sales/cash-movements/mov1/reject');
    expect(text(h)).toContain('Escribe el motivo');

    const box = byId(h, 'decision-comment') as HTMLTextAreaElement;
    box.value = 'Sin comprobante';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(h);
    (byId(h, 'decision-confirm') as HTMLButtonElement).click();
    await settle(h);
    const decision = http.expectOne('/api/v1/sales/cash-movements/mov1/reject');
    expect(decision.request.body).toEqual({ comment: 'Sin comprobante' });
    decision.flush({});
    await settle(h);
    list().flush(approvalInbox({}, ALL_ITEMS.filter((item) => item.id !== 'r-expense')));
    await settle(h);
    expect(byId(h, 'approval-r-expense')).toBeNull();
  });

  it('reads the list again when someone else decided the request first', async () => {
    const h = await loaded();
    await click(h, 'approval-approve-r-return');
    (byId(h, 'decision-confirm') as HTMLButtonElement).click();
    await settle(h);
    http.expectOne('/api/v1/sales/returns/ret1/approve').flush({ code: 'RETURN_NOT_PENDING', message: 'x' }, { status: 409, statusText: 'Conflict' });
    await settle(h);
    expect(toast.warning).toHaveBeenCalledWith('Esta devolución ya no espera una decisión.');
    list().flush(approvalInbox({}, [ALL_ITEMS[0]]));
    await settle(h);
    expect(byId(h, 'approval-r-return')).toBeNull();
  });

  it('warns when the decision was registered but the list could not be read again', async () => {
    const h = await loaded();
    await click(h, 'approval-approve-r-return');
    (byId(h, 'decision-confirm') as HTMLButtonElement).click();
    await settle(h);
    http.expectOne('/api/v1/sales/returns/ret1/approve').flush({});
    await settle(h);
    list().flush({ code: 'ERROR', message: 'boom' }, { status: 500, statusText: 'Server Error' });
    http.expectOne('/api/v1/sales/approvals/summary').flush({ pending: 3 });
    await settle(h);
    expect(toast.warning).toHaveBeenCalledWith('La decisión se registró, pero no pudimos actualizar la lista. Recárgala.');
    // the old list stays instead of an error screen
    expect(byId(h, 'approval-r-return')).not.toBeNull();
  });

  it('goes back to every type when the chosen one empties with a decision', async () => {
    const h = await loaded();
    chip(h, 'RETURN').click();
    await settle(h);
    await click(h, 'approval-approve-r-return');
    (byId(h, 'decision-confirm') as HTMLButtonElement).click();
    await settle(h);
    http.expectOne('/api/v1/sales/returns/ret1/approve').flush({});
    await settle(h);
    list().flush(approvalInbox({}, ALL_ITEMS.filter((item) => item.id !== 'r-return')));
    await settle(h);
    expect(chip(h, 'all').getAttribute('aria-pressed')).toBe('true');
    expect(byId(h, 'approvals-group-CANCELLATION')).not.toBeNull();
  });

  it('shows the empty state when nothing waits', async () => {
    const h = await loaded(approvalInbox({ kpis: { pending: 0, oldestAt: null, approvedToday: 4, rejectedToday: 0 } }, []));
    expect(byId(h, 'approvals-empty')?.textContent).toContain('No hay solicitudes pendientes');
    expect(byId(h, 'approvals-oldest')?.textContent).toContain('—');
    expect(root(h).querySelector('rs-request-card')).toBeNull();
  });

  it('says when there are more requests than shown', async () => {
    const h = await loaded(approvalInbox({ truncated: true }));
    expect(byId(h, 'approvals-truncated')?.textContent).toContain('Se muestran las más antiguas');
  });

  it('offers to retry when loading fails', async () => {
    const h = await open();
    list().flush({ code: 'ERROR', message: 'boom' }, { status: 500, statusText: 'Server Error' });
    await settle(h);
    expect(text(h)).toContain('No pudimos cargar las aprobaciones');
    (Array.from(root(h).querySelectorAll('button')).find((b) => b.textContent?.includes('Reintentar')) as HTMLButtonElement).click();
    await settle(h);
    list().flush(approvalInbox({}, [EXPENSE_ITEM]));
    await settle(h);
    expect(byId(h, 'approval-r-expense')).not.toBeNull();
  });

  it('shows the no-access state without permission', async () => {
    const h = await open();
    list().flush({ code: 'NO_PERMISSION', message: 'x' }, { status: 403, statusText: 'Forbidden' });
    await settle(h);
    expect(text(h)).toContain('No tienes permiso para ver las aprobaciones');
    expect(root(h).querySelector('rs-kpi-card')).toBeNull();
  });
});
