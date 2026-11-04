import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { CustomerSummary } from '@rodasoft/domain';
import { POS_CUSTOMER_SEARCH_DEBOUNCE_MS, PosCustomerDialog } from './pos-customer.dialog';

const CUSTOMERS = '/api/v1/sales/pos/customers';

const customer = (over: Partial<CustomerSummary> = {}): CustomerSummary => ({
  id: 'c1',
  name: 'Minera Demo Ltda.',
  documentType: 5,
  documentNumber: '1023456027',
  complement: null,
  email: 'compras@minerademo.bo',
  phone: null,
  creditEnabled: false,
  discount: { type: 'NONE', value: '0.00' },
  status: 'ACTIVE',
  ...over,
});

@Component({
  imports: [PosCustomerDialog],
  template: `<rs-pos-customer-dialog [(open)]="open" [current]="null" [saving]="saving()" (choose)="chosen.push($event)" (failed)="failures = failures + 1" />`,
})
class HostComponent {
  readonly open = signal(false);
  readonly saving = signal(false);
  readonly chosen: (CustomerSummary | null)[] = [];
  failures = 0;
}

describe('PosCustomerDialog (VP-03c)', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<HostComponent>;

  const wait = () => new Promise((resolve) => setTimeout(resolve, POS_CUSTOMER_SEARCH_DEBOUNCE_MS + 50));
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => root().textContent ?? '';
  const button = (label: string) => Array.from(root().querySelectorAll('button')).find((b) => b.textContent?.trim().startsWith(label));
  const options = () => Array.from(root().querySelectorAll<HTMLButtonElement>('button.option'));
  const searchFor = (q: string) => http.expectOne((r) => r.url === CUSTOMERS && r.params.get('q') === q);

  /** Opens the dialog; the empty search answers `first`. */
  async function open(first: CustomerSummary[] = [customer(), customer({ id: 'c2', name: 'Ferretería Demo', documentNumber: '1023998011', email: 'ventas@ferreteriademo.bo' })]) {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    fixture.componentInstance.open.set(true);
    await settle();
    await wait();
    searchFor('').flush({ items: first });
    await settle();
  }

  afterEach(() => http.verify());

  it('shows the heading, the search field and the customers found, each with its NIT and e-mail', async () => {
    await open();
    expect(text()).toContain('Cliente y datos de factura');
    expect(text()).toContain('Busca por NIT, CI o razón social. Los datos se usan en la factura del SIAT.');
    expect(root().querySelector<HTMLInputElement>('#pos-customer-search')).not.toBeNull();
    expect(options().map((o) => o.textContent)).toEqual([
      expect.stringContaining('Minera Demo Ltda.'),
      expect.stringContaining('Ferretería Demo'),
    ]);
    expect(options()[0].textContent).toContain('NIT 1023456027 · compras@minerademo.bo');
  });

  it('searches as the cashier types, after a pause, and shows the new results', async () => {
    await open();
    const input = root().querySelector<HTMLInputElement>('#pos-customer-search')!;
    input.value = '1023';
    input.dispatchEvent(new Event('input'));
    await settle();
    expect(root().querySelector('[role=status]')).not.toBeNull();
    await wait();
    searchFor('1023').flush({ items: [customer()] });
    await settle();
    expect(options()).toHaveLength(1);
  });

  it('says so when nothing matches, and offers a new customer', async () => {
    await open();
    const input = root().querySelector<HTMLInputElement>('#pos-customer-search')!;
    input.value = 'zzz';
    input.dispatchEvent(new Event('input'));
    await wait();
    searchFor('zzz').flush({ items: [] });
    await settle();
    expect(text()).toContain('Sin clientes para «zzz»');
    expect(button('Nuevo cliente')).toBeDefined();
  });

  it('shows an error with a retry when the search fails', async () => {
    await open();
    const input = root().querySelector<HTMLInputElement>('#pos-customer-search')!;
    input.value = 'abc';
    input.dispatchEvent(new Event('input'));
    await wait();
    searchFor('abc').flush({}, { status: 500, statusText: 'Server Error' });
    await settle();
    expect(text()).toContain('No pudimos buscar clientes.');
    expect(fixture.componentInstance.failures).toBe(1);
    button('Reintentar')!.click();
    await wait();
    searchFor('abc').flush({ items: [customer()] });
    await settle();
    expect(options()).toHaveLength(1);
  });

  it('"Usar" stays disabled until a customer is picked, then chooses it', async () => {
    await open();
    expect(button('Usar cliente')!.disabled).toBe(true);
    options()[0].click();
    await settle();
    expect(options()[0].getAttribute('aria-pressed')).toBe('true');
    const use = button('Usar cliente')!;
    expect(use.disabled).toBe(false);
    use.click();
    expect(fixture.componentInstance.chosen).toEqual([customer()]);
  });

  it('"Consumidor final" chooses no customer', async () => {
    await open();
    button('Consumidor final')!.click();
    expect(fixture.componentInstance.chosen).toEqual([null]);
  });

  it('waits for the page while it is setting the customer', async () => {
    await open();
    options()[0].click();
    fixture.componentInstance.saving.set(true);
    await settle();
    expect(button('Usar cliente')!.disabled).toBe(true);
    expect(button('Consumidor final')!.disabled).toBe(true);
  });

  it('Cancelar closes the dialog without choosing', async () => {
    await open();
    button('Cancelar')!.click();
    await settle();
    expect(fixture.componentInstance.open()).toBe(false);
    expect(fixture.componentInstance.chosen).toEqual([]);
  });

  describe('new customer', () => {
    const fillAndSave = async (number: string, name: string) => {
      const set = (suffix: string, value: string) => {
        const input = root().querySelector<HTMLInputElement>(`input[id$="-${suffix}"]`)!;
        input.value = value;
        input.dispatchEvent(new Event('input'));
      };
      set('number', number);
      set('name', name);
      await settle();
      button('Guardar y usar')!.click();
      await settle();
    };

    it('opens the quick form, creates the customer and chooses it', async () => {
      await open();
      button('Nuevo cliente')!.click();
      await settle();
      expect(text()).toContain('Número de documento');
      expect(text()).not.toContain('Crédito habilitado');

      await fillAndSave('1020304078', 'Taller Los Andes');
      const created = customer({ id: 'c9', name: 'Taller Los Andes', documentNumber: '1020304078', email: null });
      const req = http.expectOne((r) => r.url === CUSTOMERS && r.method === 'POST');
      expect(req.request.body).toMatchObject({ name: 'Taller Los Andes', documentType: 5, documentNumber: '1020304078' });
      expect(req.request.body).not.toHaveProperty('discountType');
      req.flush(created);
      await settle();
      expect(fixture.componentInstance.chosen).toEqual([created]);
    });

    it('does not call the API with an invalid NIT', async () => {
      await open();
      button('Nuevo cliente')!.click();
      await settle();
      await fillAndSave('12a45', 'Taller');
      http.expectNone((r) => r.method === 'POST');
      expect(text()).toContain('NIT inválido');
    });

    it('offers the existing customer when the document is already registered', async () => {
      await open();
      button('Nuevo cliente')!.click();
      await settle();
      await fillAndSave('1023456027', 'Otro nombre');
      http.expectOne((r) => r.method === 'POST').flush(
        { code: 'CUSTOMER_DOCUMENT_DUPLICATED', message: 'duplicate', details: { customer: customer() } },
        { status: 409, statusText: 'Conflict' },
      );
      await settle();
      expect(text()).toContain('Este documento ya está registrado');
      expect(options()).toHaveLength(1);
      expect(button('Usar cliente')!.disabled).toBe(false);
    });

    it('shows the API error in the form for any other refusal', async () => {
      await open();
      button('Nuevo cliente')!.click();
      await settle();
      await fillAndSave('1020304078', 'Taller');
      http.expectOne((r) => r.method === 'POST').flush({ code: 'INVALID_NIT', message: 'x' }, { status: 400, statusText: 'Bad Request' });
      await settle();
      expect(text()).toContain('El documento del cliente no es válido para facturar.');
    });

    it('Cancelar goes back to the search', async () => {
      await open();
      button('Nuevo cliente')!.click();
      await settle();
      button('Cancelar')!.click();
      await settle();
      expect(root().querySelector('#pos-customer-search')).not.toBeNull();
    });
  });
});
