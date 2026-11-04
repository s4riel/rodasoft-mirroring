import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CustomerListResponse, CustomerSummary } from '@rodasoft/domain';
import { ContextStore } from '../../../core/context.store';
import { CUSTOMERS_SEARCH_DEBOUNCE_MS, CustomersPage } from './customers.page';

const URL = '/api/v1/sales/customers';

const customer = (over: Partial<CustomerSummary> = {}): CustomerSummary => ({
  id: 'c1',
  name: 'Minera Demo Ltda.',
  documentType: 5,
  documentNumber: '1023456027',
  complement: null,
  email: 'compras@minerademo.bo',
  phone: '70012345',
  creditEnabled: true,
  discount: { type: 'PERCENT', value: '10.00' },
  status: 'ACTIVE',
  ...over,
});

const list = (items: CustomerSummary[], over: Partial<CustomerListResponse> = {}): CustomerListResponse => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25,
  ...over,
});

describe('CustomersPage (HU-VEN-37)', () => {
  let http: HttpTestingController;

  async function open(granted = ['sales.customers.manage'], answer: CustomerListResponse | 'error' | null = list([customer()])) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'sales/customers', component: CustomersPage }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ContextStore, useValue: { can: (p: string) => granted.includes(p), context: signal(null), currentBranch: () => null } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/sales/customers');
    if (granted.includes('sales.customers.manage') && answer !== null) {
      await settle(h);
      const req = http.expectOne((r) => r.url === URL);
      if (answer === 'error') req.flush({}, { status: 500, statusText: 'Server Error' });
      else req.flush(answer);
    }
    await settle(h);
    return h;
  }

  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  const text = (h: RouterTestingHarness) => root(h).textContent ?? '';
  const button = (h: RouterTestingHarness, label: string, within: ParentNode = root(h)) =>
    Array.from(within.querySelectorAll('button')).find((b) => b.textContent?.trim().includes(label));
  const dialog = (h: RouterTestingHarness) => root(h).querySelector<HTMLElement>('[role=dialog]');
  async function settle(h: RouterTestingHarness) {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }

  afterEach(() => http.verify());

  it('lists the customers with their document, contact, credit, discount and status', async () => {
    const h = await open(undefined, list([customer(), customer({ id: 'c2', name: 'Taller Andes', documentType: 1, documentNumber: '4567890', complement: '1A', email: null, phone: null, creditEnabled: false, discount: { type: 'AMOUNT', value: '15.00' }, status: 'INACTIVE' })]));
    const cells = text(h);
    expect(cells).toContain('Minera Demo Ltda.');
    expect(cells).toContain('NIT 1023456027');
    expect(cells).toContain('compras@minerademo.bo · 70012345');
    expect(cells).toContain('10 % de descuento');
    expect(cells).toContain('CI 4567890-1A');
    expect(cells).toContain('Bs 15,00 de descuento por venta');
    expect(cells).toContain('Activo');
    expect(cells).toContain('Inactivo');
    expect(cells).toContain('Mostrando 1–2 de 2');
  });

  it('asks for the active customers first', async () => {
    TestBed.resetTestingModule();
    const h = await open(undefined, null);
    const req = http.expectOne((r) => r.url === URL);
    expect(req.request.params.get('status')).toBe('ACTIVE');
    expect(req.request.params.get('page')).toBe('1');
    req.flush(list([]));
    await settle(h);
  });

  it('shows the empty state with a way to create the first customer', async () => {
    const h = await open(undefined, list([]));
    expect(text(h)).toContain('Todavía no hay clientes');
    expect(button(h, 'Nuevo cliente', root(h).querySelector('section.state')!)).toBeDefined();
  });

  it('shows the error state and retries', async () => {
    const h = await open(undefined, 'error');
    expect(text(h)).toContain('No pudimos cargar los clientes');
    button(h, 'Reintentar')!.click();
    await settle(h);
    http.expectOne((r) => r.url === URL).flush(list([customer()]));
    await settle(h);
    expect(text(h)).toContain('Minera Demo Ltda.');
  });

  it('shows the no-permission state without calling the API', async () => {
    const h = await open(['sales.pos.use'], null);
    expect(text(h)).toContain('No tienes permiso para gestionar clientes');
  });

  it('searches by name or document after a pause', async () => {
    const h = await open();
    const input = root(h).querySelector<HTMLInputElement>('input[type=search], input')!;
    input.value = '1023';
    input.dispatchEvent(new Event('input'));
    await new Promise((resolve) => setTimeout(resolve, CUSTOMERS_SEARCH_DEBOUNCE_MS + 50));
    await settle(h);
    const req = http.expectOne((r) => r.url === URL);
    expect(req.request.params.get('q')).toBe('1023');
    req.flush(list([]));
    await settle(h);
    expect(text(h)).toContain('No encontramos clientes');
  });

  describe('the form', () => {
    const fill = async (h: RouterTestingHarness, suffix: string, value: string) => {
      const input = dialog(h)!.querySelector<HTMLInputElement>(`input[id$="-${suffix}"]`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await settle(h);
    };

    it('creates a customer with the credit flag and a discount, and reloads the list', async () => {
      const h = await open();
      button(h, 'Nuevo cliente')!.click();
      await settle(h);
      expect(dialog(h)!.textContent).toContain('Crédito habilitado');
      expect(dialog(h)!.textContent).toContain('Descuento');

      await fill(h, 'number', '5550001112');
      await fill(h, 'name', 'Minera Sur');
      button(h, 'Crear cliente', dialog(h)!)!.click();
      await settle(h);
      const post = http.expectOne((r) => r.url === URL && r.method === 'POST');
      expect(post.request.body).toMatchObject({ name: 'Minera Sur', documentType: 5, documentNumber: '5550001112', discountType: 'NONE', discountValue: '0', creditEnabled: false });
      post.flush(customer({ id: 'c9', name: 'Minera Sur' }));
      await settle(h);
      expect(dialog(h)).toBeNull();
      http.expectOne((r) => r.url === URL && r.method === 'GET').flush(list([customer({ id: 'c9', name: 'Minera Sur' })]));
      await settle(h);
      expect(text(h)).toContain('Cliente creado: Minera Sur.');
    });

    it('shows the API refusal inside the form and keeps it open', async () => {
      const h = await open();
      button(h, 'Nuevo cliente')!.click();
      await settle(h);
      await fill(h, 'number', '5550001112');
      await fill(h, 'name', 'Minera Sur');
      button(h, 'Crear cliente', dialog(h)!)!.click();
      await settle(h);
      http.expectOne((r) => r.method === 'POST').flush({ code: 'CUSTOMER_DOCUMENT_DUPLICATED', message: 'dup' }, { status: 409, statusText: 'Conflict' });
      await settle(h);
      expect(dialog(h)).not.toBeNull();
      expect(dialog(h)!.textContent).toContain('Ya existe un cliente con este documento.');
    });

    it('edits a customer from its row menu with PATCH', async () => {
      const h = await open();
      root(h).querySelector<HTMLButtonElement>('rs-row-action button')!.click();
      await settle(h);
      Array.from(root(h).querySelectorAll<HTMLElement>('[role=menuitem], button')).find((b) => b.textContent?.includes('Editar cliente'))!.click();
      await settle(h);
      expect(dialog(h)!.textContent).toContain('Editar cliente');
      expect(dialog(h)!.querySelector<HTMLInputElement>('input[id$="-name"]')!.value).toBe('Minera Demo Ltda.');
      await fill(h, 'discount-value', '12,5');
      button(h, 'Guardar cambios', dialog(h)!)!.click();
      await settle(h);
      const patch = http.expectOne((r) => r.url === `${URL}/c1` && r.method === 'PATCH');
      expect(patch.request.body).toMatchObject({ discountType: 'PERCENT', discountValue: '12.5', creditEnabled: true, status: 'ACTIVE' });
      patch.flush(customer({ discount: { type: 'PERCENT', value: '12.50' } }));
      await settle(h);
      http.expectOne((r) => r.url === URL && r.method === 'GET').flush(list([customer({ discount: { type: 'PERCENT', value: '12.50' } })]));
      await settle(h);
      expect(text(h)).toContain('12,5 % de descuento');
    });
  });
});
