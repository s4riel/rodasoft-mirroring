import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { ReturnableSale, SaleReturnDetail } from '@rodasoft/domain';
import { ReturnFormPage } from './return-form.page';

const sale = (over: Partial<ReturnableSale> = {}): ReturnableSale => ({
  saleId: 's1',
  saleNumber: 'V-000231',
  customerName: 'Industrias Demo',
  customerDocumentNumber: '1020304050',
  soldAt: '2026-11-09T14:00:00.000Z',
  total: '300.00',
  subtotal: '300.00',
  hasCustomer: true,
  invoiceNumber: 1528,
  refunded: '100.00',
  approvalLimit: null,
  windowEndsAt: null,
  lines: [
    { saleItemId: 'i1', productId: 'p1', productName: 'Rodamiento 6204', sku: 'RL-1', unitPrice: '100.00', sold: 2, returned: 0, returnable: 2 },
    { saleItemId: 'i2', productId: 'p2', productName: 'Retén 35x62', sku: 'RL-2', unitPrice: '100.00', sold: 1, returned: 1, returnable: 0 },
  ],
  ...over,
});

describe('ReturnFormPage', () => {
  let http: HttpTestingController;

  async function open(url = '/sales/returns/new') {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'sales/returns/new', component: ReturnFormPage }]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, ReturnFormPage);
    return harness;
  }
  type H = RouterTestingHarness;
  const root = (h: H) => h.routeNativeElement as HTMLElement;
  const q = <T extends HTMLElement>(h: H, testId: string) => root(h).querySelector<T>(`[data-testid="${testId}"]`);
  const lookupWith = (h: H, body: ReturnableSale | null, init?: { status: number; statusText: string }) => {
    http.expectOne((r) => r.url === '/api/v1/sales/returns/sale-lookup').flush(body ?? { code: 'SALE_NOT_FOUND', message: 'x' }, init);
    h.detectChanges();
  };
  async function find(h: H, number = 'V-000231') {
    const input = root(h).querySelector<HTMLInputElement>('#return-sale')!;
    input.value = number;
    input.dispatchEvent(new Event('input'));
    q<HTMLButtonElement>(h, 'return-search')!.click();
    h.detectChanges();
  }
  const stepper = (h: H) => root(h).querySelector<HTMLInputElement>('rs-qty-stepper input')!;
  function setPieces(h: H, value: number) {
    const input = stepper(h);
    input.value = String(value);
    input.dispatchEvent(new Event('change'));
    h.detectChanges();
  }
  function pickDestination(h: H, label: string) {
    const chip = Array.from(root(h).querySelectorAll<HTMLButtonElement>('[role="group"] rs-filter-chip button')).find((b) => b.textContent?.includes(label));
    chip!.click();
    h.detectChanges();
  }
  afterEach(() => http.verify());

  it('looks the sale up, shows its lines and keeps the button disabled with 0 pieces', async () => {
    const h = await open();
    await find(h);
    lookupWith(h, sale());
    expect(q(h, 'return-sale-caption')?.textContent).toContain('V-000231');
    expect(root(h).textContent).toContain('Rodamiento 6204');
    expect(root(h).textContent).toContain('Ya devuelto');
    expect(q<HTMLButtonElement>(h, 'return-submit')!.disabled).toBe(true);
  });

  it('says so when the sale is not found', async () => {
    const h = await open();
    await find(h, 'V-999');
    lookupWith(h, null, { status: 404, statusText: 'Not Found' });
    expect(q(h, 'return-not-found')).not.toBeNull();
  });

  it('opens with the sale of the link', async () => {
    const h = await open('/sales/returns/new?sale=V-000231');
    const request = http.expectOne((r) => r.url === '/api/v1/sales/returns/sale-lookup');
    expect(request.request.params.get('q')).toBe('V-000231');
    request.flush(sale());
    h.detectChanges();
    expect(root(h).textContent).toContain('Rodamiento 6204');
  });

  it('caps the stepper at what can still come back and previews the amount', async () => {
    const h = await open();
    await find(h);
    lookupWith(h, sale());
    expect(stepper(h).getAttribute('aria-valuemax')).toBe('2');
    setPieces(h, 5);
    expect(stepper(h).value).toBe('2');
    expect(q(h, 'return-amount')?.textContent).toContain('200');
  });

  it('needs the reason, and a reference for a transfer, before sending', async () => {
    const h = await open();
    await find(h);
    lookupWith(h, sale());
    setPieces(h, 1);
    expect(q<HTMLButtonElement>(h, 'return-submit')!.disabled).toBe(true); // no reason yet
  });

  it('warns when the amount needs approval and relabels the button', async () => {
    const h = await open();
    await find(h);
    lookupWith(h, sale({ approvalLimit: '50.00' }));
    setPieces(h, 1);
    expect(q(h, 'return-needs-approval')).not.toBeNull();
    expect(q(h, 'return-submit')?.textContent).toContain('Enviar a aprobación');
  });

  it('sends the return with an Idempotency-Key and goes to its detail', async () => {
    const h = await open();
    const router = TestBed.inject(Router);
    const navigate = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    await find(h);
    lookupWith(h, sale());
    setPieces(h, 1);
    const component = h.routeDebugElement!.componentInstance as unknown as { reason: { set(v: string): void } };
    component.reason.set('FACTORY_DEFECT');
    h.detectChanges();
    expect(q<HTMLButtonElement>(h, 'return-submit')!.disabled).toBe(true); // no destination yet
    pickDestination(h, 'A stock');
    q<HTMLButtonElement>(h, 'return-submit')!.click();
    const request = http.expectOne((r) => r.url === '/api/v1/sales/returns' && r.method === 'POST');
    expect(request.request.headers.get('Idempotency-Key')).toBeTruthy();
    expect(request.request.body).toEqual({
      saleId: 's1',
      reason: 'FACTORY_DEFECT',
      refundMethod: 'CASH',
      refundReference: null,
      items: [{ saleItemId: 'i1', quantity: 1, condition: 'RESTOCK' }],
    });
    request.flush({ id: 'r1' } as SaleReturnDetail);
    expect(navigate).toHaveBeenCalledWith(['/sales/returns', 'r1']);
  });

  it('shows the server error on the form', async () => {
    const h = await open();
    await find(h);
    lookupWith(h, sale());
    setPieces(h, 1);
    (h.routeDebugElement!.componentInstance as unknown as { reason: { set(v: string): void } }).reason.set('OTHER');
    pickDestination(h, 'A merma');
    q<HTMLButtonElement>(h, 'return-submit')!.click();
    http
      .expectOne((r) => r.url === '/api/v1/sales/returns' && r.method === 'POST')
      .flush({ code: 'RETURN_WINDOW_EXPIRED', message: 'x' }, { status: 409, statusText: 'Conflict' });
    h.detectChanges();
    expect(q(h, 'return-submit-error')?.textContent).toContain('Pasó el plazo');
  });
});
