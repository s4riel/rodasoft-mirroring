import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { ApprovalInboxItem } from '@rodasoft/domain';
import { ToastService } from '@rodasoft/ui';
import { ApprovalDecisionDialog, type ApprovalDecision, type ApprovalDecisionOutcome } from './approval-decision.dialog';
import { EXPENSE_ITEM, RETURN_ITEM } from './approvals.testing';

@Component({
  imports: [ApprovalDecisionDialog],
  template: `<rs-approval-decision-dialog [(open)]="open" [item]="item()" [decision]="decision()" (decided)="outcome.set($event)" />`,
})
class HostComponent {
  readonly open = signal(true);
  readonly item = signal<ApprovalInboxItem | null>(RETURN_ITEM);
  readonly decision = signal<ApprovalDecision>('approve');
  readonly outcome = signal<ApprovalDecisionOutcome | null>(null);
}

/** VP-25 · Aprobar / Rechazar from the inbox (HU-VEN-29). */
describe('ApprovalDecisionDialog', () => {
  let http: HttpTestingController;
  const toast = { success: jest.fn(), warning: jest.fn() };

  async function setup(item: ApprovalInboxItem = RETURN_ITEM, decision: ApprovalDecision = 'approve') {
    toast.success.mockClear();
    toast.warning.mockClear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), { provide: ToastService, useValue: toast }] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.item.set(item);
    fixture.componentInstance.decision.set(decision);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, host: fixture.componentInstance };
  }

  async function settle(fixture: ComponentFixture<HostComponent>) {
    await fixture.whenStable();
    fixture.detectChanges();
  }
  async function write(fixture: ComponentFixture<HostComponent>, value: string) {
    const box = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="decision-comment"]') as HTMLTextAreaElement;
    box.value = value;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(fixture);
  }
  const byId = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const confirm = async (fixture: ComponentFixture<HostComponent>) => {
    (byId(fixture.nativeElement, 'decision-confirm') as HTMLButtonElement).click();
    await settle(fixture);
  };
  const text = (el: HTMLElement) => el.textContent?.replace(/\s+/g, ' ') ?? '';

  afterEach(() => http.verify());

  it('summarises the return it is about and takes an optional comment to approve', async () => {
    const { el } = await setup();
    expect(text(el)).toContain('Aprobar devolución');
    expect(byId(el, 'decision-title')?.textContent).toContain('DEV-000012 · venta V-000231');
    expect(byId(el, 'decision-summary')?.textContent).toContain('Ana Cajera');
    expect(byId(el, 'decision-summary')?.textContent).toContain('−Bs 200,00');
    expect(text(el)).toContain('Comentario (opcional)');
    expect(byId(el, 'decision-confirm')?.textContent?.trim()).toBe('Aprobar');
  });

  it('approves a return through its own endpoint, without a comment', async () => {
    const { fixture, host } = await setup();
    await confirm(fixture);
    const req = http.expectOne('/api/v1/sales/returns/ret1/approve');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({});
    await settle(fixture);
    expect(toast.success).toHaveBeenCalledWith('Solicitud aprobada');
    expect(host.outcome()).toBe('done');
    expect(host.open()).toBe(false);
  });

  it('sends the comment, trimmed', async () => {
    const { fixture } = await setup();
    await write(fixture, '  Conforme  ');
    await confirm(fixture);
    const req = http.expectOne('/api/v1/sales/returns/ret1/approve');
    expect(req.request.body).toEqual({ comment: 'Conforme' });
    req.flush({});
  });

  it('needs the reply to reject, and sends nothing without it', async () => {
    const { fixture, el, host } = await setup(EXPENSE_ITEM, 'reject');
    expect(text(el)).toContain('Rechazar gasto de caja');
    expect(text(el)).toContain('Motivo del rechazo');
    await confirm(fixture);
    http.expectNone('/api/v1/sales/cash-movements/mov1/reject');
    expect(text(el)).toContain('Escribe el motivo: el cajero lo va a leer.');
    expect(host.open()).toBe(true);

    await write(fixture, 'Sin comprobante');
    await confirm(fixture);
    const req = http.expectOne('/api/v1/sales/cash-movements/mov1/reject');
    expect(req.request.body).toEqual({ comment: 'Sin comprobante' });
    req.flush({});
    await settle(fixture);
    expect(toast.success).toHaveBeenCalledWith('Solicitud rechazada');
    expect(host.outcome()).toBe('done');
  });

  it('approves a cash expense through the cash endpoint', async () => {
    const { fixture } = await setup(EXPENSE_ITEM, 'approve');
    await confirm(fixture);
    http.expectOne('/api/v1/sales/cash-movements/mov1/approve').flush({});
  });

  it('shows the error inside the dialog and keeps it open', async () => {
    const { fixture, el, host } = await setup(EXPENSE_ITEM, 'approve');
    await confirm(fixture);
    http.expectOne('/api/v1/sales/cash-movements/mov1/approve').flush({ code: 'CASH_EXPENSE_EXCEEDS_CASH', message: 'x' }, { status: 409, statusText: 'Conflict' });
    await settle(fixture);
    expect(byId(el, 'decision-error')?.textContent).toContain('El egreso supera el efectivo que hay en la caja.');
    expect(host.open()).toBe(true);
    expect(host.outcome()).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it.each([
    ['RETURN_NOT_PENDING', RETURN_ITEM, '/api/v1/sales/returns/ret1/approve'],
    ['CASH_MOVEMENT_NOT_PENDING', EXPENSE_ITEM, '/api/v1/sales/cash-movements/mov1/approve'],
  ])('says so and asks the inbox to read again when someone decided first (%s)', async (code, item, url) => {
    const { fixture, host } = await setup(item);
    await confirm(fixture);
    http.expectOne(url).flush({ code, message: 'x' }, { status: 409, statusText: 'Conflict' });
    await settle(fixture);
    expect(toast.warning).toHaveBeenCalled();
    expect(host.outcome()).toBe('stale');
    expect(host.open()).toBe(false);
  });

  it('starts clean every time it opens', async () => {
    const { fixture, host, el } = await setup(EXPENSE_ITEM, 'reject');
    await write(fixture, 'Sin comprobante');
    host.open.set(false);
    await settle(fixture);
    host.open.set(true);
    await settle(fixture);
    expect((byId(el, 'decision-comment') as HTMLTextAreaElement).value).toBe('');
    expect(text(el)).not.toContain('Escribe el motivo');
  });

  it('closes with Cancelar and sends nothing', async () => {
    const { fixture, host, el } = await setup();
    const cancel = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Cancelar') as HTMLButtonElement;
    cancel.click();
    await settle(fixture);
    expect(host.open()).toBe(false);
    http.expectNone('/api/v1/sales/returns/ret1/approve');
  });
});
