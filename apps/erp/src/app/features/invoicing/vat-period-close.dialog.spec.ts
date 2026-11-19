import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { VatPeriodBlockers } from '@rodasoft/domain';
import { VatPeriodCloseDialog } from './vat-period-close.dialog';

const BLOCKERS = '/api/v1/invoicing/vat-periods/2026-10/blockers';
const CLOSE = '/api/v1/invoicing/vat-periods/2026-10/close';

const blockers = (over: Partial<VatPeriodBlockers> = {}): VatPeriodBlockers => ({ period: '2026-10', error: null, blockers: [], cancellationRequests: 0, documents: [], purchases: [], ...over });

describe('VatPeriodCloseDialog (FS-40)', () => {
  let http: HttpTestingController;

  async function render() {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(VatPeriodCloseDialog);
    fixture.componentRef.setInput('period', '2026-10');
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }
  type Fixture = Awaited<ReturnType<typeof render>>;
  const el = (f: Fixture) => f.nativeElement as HTMLElement;
  const confirm = (f: Fixture) => el(f).querySelector<HTMLButtonElement>('[data-testid="close-confirm"]')!;
  async function settle(f: Fixture) {
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
  }

  afterEach(() => http.verify());

  it('lists the pending documents and purchases, says it cannot close and offers to see them', async () => {
    const f = await render();
    http.expectOne(BLOCKERS).flush(
      blockers({
        blockers: [
          { code: 'INVOICES_NOT_ISSUED', count: 2 },
          { code: 'PURCHASES_OBSERVED', count: 1 },
        ],
        documents: [{ kind: 'INVOICE', id: 'i1', number: null, status: 'PENDING', customerName: 'Industrias Demo', total: '120.00' }],
        purchases: [{ id: 'p1', supplierName: 'Embalajes Demo', invoiceNumber: '000221', total: '1200.00' }],
      }),
    );
    await settle(f);
    const text = el(f).textContent ?? '';
    expect(text).toContain('2 facturas sin emitir en el SIAT');
    expect(text).toContain('1 compra observada');
    expect(text).toContain('Industrias Demo');
    expect(text).toContain('Embalajes Demo');
    expect(text).toContain('No se puede cerrar');
    expect(confirm(f)).toBeNull();
    expect(el(f).querySelector('[data-testid="close-see-pending"]')?.textContent).toContain('Ver pendientes');
  });

  it('warns about cancellation requests still waiting, without stopping the close', async () => {
    const f = await render();
    http.expectOne(BLOCKERS).flush(blockers({ cancellationRequests: 2 }));
    await settle(f);
    expect(el(f).querySelector('[data-testid="close-requests"]')?.textContent).toContain('2 solicitudes de anulación pendientes');
    expect(el(f).querySelector('[data-testid="close-requests"]')?.textContent).toContain('nota de crédito');
    expect(confirm(f).disabled).toBe(false);
  });

  it('says why a period that is not allowed to close cannot', async () => {
    const f = await render();
    http.expectOne(BLOCKERS).flush(blockers({ error: 'PREVIOUS_PERIOD_OPEN' }));
    await settle(f);
    expect(el(f).querySelector('[data-testid="close-error"]')?.textContent).toContain('anterior sigue abierto');
    expect(confirm(f).disabled).toBe(true);
  });

  it('closes the period when nothing is pending, then tells the screen', async () => {
    const f = await render();
    const closed = jest.fn();
    f.componentInstance.closed.subscribe(closed);
    http.expectOne(BLOCKERS).flush(blockers());
    await settle(f);
    expect(el(f).querySelector('[data-testid="close-ready"]')?.textContent).toContain('quedan fijos');
    expect(confirm(f).disabled).toBe(false);
    confirm(f).click();
    http.expectOne(CLOSE).flush({});
    await settle(f);
    expect(closed).toHaveBeenCalled();
    expect(f.componentInstance.open()).toBe(false);
  });

  it('keeps the dialog open and says why the API refused', async () => {
    const f = await render();
    http.expectOne(BLOCKERS).flush(blockers());
    await settle(f);
    confirm(f).click();
    http.expectOne(CLOSE).flush({ code: 'PERIOD_HAS_PENDING', message: 'x' }, { status: 409, statusText: 'Conflict' });
    await settle(f);
    expect(el(f).querySelector('[data-testid="close-save-error"]')?.textContent).toContain('documentos sin emitir');
    expect(f.componentInstance.open()).toBe(true);
  });

  it('shows the error when the period cannot be checked', async () => {
    const f = await render();
    http.expectOne(BLOCKERS).flush({ code: 'X', message: 'boom' }, { status: 500, statusText: 'Server Error' });
    await settle(f);
    expect(el(f).querySelector('[data-testid="close-load-error"]')).not.toBeNull();
    expect(confirm(f).disabled).toBe(true);
  });
});
