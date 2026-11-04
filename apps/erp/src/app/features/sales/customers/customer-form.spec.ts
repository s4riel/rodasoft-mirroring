import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { FormGroup } from '@angular/forms';
import { By } from '@angular/platform-browser';
import type { CustomerSummary, SaveCustomerInput } from '@rodasoft/domain';
import { CustomerForm } from './customer-form';

const minera: CustomerSummary = {
  id: 'c1',
  name: 'Minera Demo Ltda.',
  documentType: 5,
  documentNumber: '1023456027',
  complement: null,
  email: 'compras@minerademo.bo',
  phone: null,
  creditEnabled: true,
  discount: { type: 'PERCENT', value: '10.00' },
  status: 'ACTIVE',
};

@Component({
  imports: [CustomerForm],
  template: `
    <rs-customer-form
      [full]="full()"
      [customer]="customer()"
      [serverError]="serverError()"
      (save)="saved.push($event)"
      (cancelled)="cancelledCount = cancelledCount + 1"
    />
  `,
})
class HostComponent {
  readonly full = signal(false);
  readonly customer = signal<CustomerSummary | null>(null);
  readonly serverError = signal<string | null>(null);
  readonly saved: SaveCustomerInput[] = [];
  cancelledCount = 0;
}

describe('CustomerForm', () => {
  async function render(setup?: (host: HostComponent) => void) {
    const fixture = TestBed.createComponent(HostComponent);
    setup?.(fixture.componentInstance);
    await fixture.whenStable();
    const el = (): HTMLElement => fixture.nativeElement.querySelector('rs-customer-form');
    const form = () => fixture.debugElement.query(By.directive(CustomerForm)).componentInstance.form as FormGroup;
    const fill = async (values: Record<string, unknown>) => {
      form().patchValue(values);
      await fixture.whenStable();
    };
    const submit = async () => {
      el().querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
      await fixture.whenStable();
    };
    const text = () => el().textContent ?? '';
    return { fixture, host: fixture.componentInstance, el, fill, submit, text };
  }

  describe('quick creation (the cashier)', () => {
    it('has no discount, credit or active fields', async () => {
      const { text } = await render();
      expect(text()).not.toContain('Descuento');
      expect(text()).not.toContain('Crédito');
      expect(text()).not.toContain('Cliente activo');
    });

    it('asks for the document and the name before saving', async () => {
      const { host, submit, text } = await render();
      await submit();
      expect(host.saved).toEqual([]);
      expect(text()).toContain('Ingresa el número de documento.');
      expect(text()).toContain('Ingresa el nombre o la razón social.');
    });

    it('refuses an invalid NIT with the reason', async () => {
      const { host, fill, submit, text } = await render();
      await fill({ documentNumber: '12a45', name: 'Taller' });
      await submit();
      expect(host.saved).toEqual([]);
      expect(text()).toContain('NIT inválido: usa de 5 a 13 dígitos.');
    });

    it('refuses a CI with letters', async () => {
      const { host, fill, submit, text } = await render();
      await fill({ documentType: 1, documentNumber: '45A7890', name: 'Juan' });
      await submit();
      expect(host.saved).toEqual([]);
      expect(text()).toContain('CI inválido');
    });

    it('refuses an e-mail that is not one', async () => {
      const { host, fill, submit, text } = await render();
      await fill({ documentNumber: '1020304078', name: 'Taller', email: 'no-es-correo' });
      await submit();
      expect(host.saved).toEqual([]);
      expect(text()).toContain('Ingresa un correo válido.');
    });

    it('emits the normalized data with no discount and no credit', async () => {
      const { host, fill, submit } = await render();
      await fill({ documentNumber: '1020 304-078', name: '  Taller Los Andes ', email: ' ventas@taller.bo ', phone: '' });
      await submit();
      expect(host.saved).toEqual([
        {
          name: 'Taller Los Andes',
          documentType: 5,
          documentNumber: '1020304078',
          complement: null,
          email: 'ventas@taller.bo',
          phone: null,
          creditEnabled: false,
          discountType: 'NONE',
          discountValue: '0',
        },
      ]);
    });

    it('shows the complement only for a CI and sends it in capitals', async () => {
      const { host, el, fill, submit } = await render();
      expect(el().querySelector('input[id$="-complement"]')).toBeNull();
      await fill({ documentType: 1, documentNumber: '4567890', complement: '1a', name: 'Juan Pérez' });
      expect(el().querySelector('input[id$="-complement"]')).not.toBeNull();
      await submit();
      expect(host.saved[0]).toMatchObject({ documentType: 1, documentNumber: '4567890', complement: '1A' });
    });

    it('shows the error the API answered and emits cancel', async () => {
      const { host, fixture, el, text } = await render();
      host.serverError.set('Ya existe un cliente con este documento.');
      await fixture.whenStable();
      expect(text()).toContain('Ya existe un cliente con este documento.');
      Array.from(el().querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === 'Cancelar')?.click();
      expect(host.cancelledCount).toBe(1);
    });
  });

  describe('the full form (Management, HU-VEN-37)', () => {
    const full = (host: HostComponent) => host.full.set(true);

    it('has the credit flag and the discount', async () => {
      const { text } = await render(full);
      expect(text()).toContain('Descuento');
      expect(text()).toContain('Crédito habilitado');
    });

    it('does not ask for a value with no discount, and sends "0"', async () => {
      const { host, el, fill, submit } = await render(full);
      expect(el().querySelector('input[id$="-discount-value"]')).toBeNull();
      await fill({ documentNumber: '1020304078', name: 'Taller' });
      await submit();
      expect(host.saved[0]).toMatchObject({ discountType: 'NONE', discountValue: '0', creditEnabled: false, status: 'ACTIVE' });
    });

    it('sends a percent with a decimal comma as a decimal string', async () => {
      const { host, fill, submit } = await render(full);
      await fill({ documentNumber: '1020304078', name: 'Taller', discountType: 'PERCENT', discountValue: '10,5', creditEnabled: true });
      await submit();
      expect(host.saved[0]).toMatchObject({ discountType: 'PERCENT', discountValue: '10.5', creditEnabled: true });
    });

    it('sends a fixed amount per sale', async () => {
      const { host, fill, submit } = await render(full);
      await fill({ documentNumber: '1020304078', name: 'Taller', discountType: 'AMOUNT', discountValue: '15' });
      await submit();
      expect(host.saved[0]).toMatchObject({ discountType: 'AMOUNT', discountValue: '15' });
    });

    it.each([
      ['a percent above 100', 'PERCENT', '100,5', 'Ingresa un porcentaje mayor que 0 y hasta 100.'],
      ['a percent of 0', 'PERCENT', '0', 'Ingresa un porcentaje mayor que 0 y hasta 100.'],
      ['an empty amount', 'AMOUNT', '', 'Ingresa un monto en Bs mayor que 0.'],
    ])('refuses %s', async (_label, discountType, discountValue, message) => {
      const { host, fill, submit, text } = await render(full);
      await fill({ documentNumber: '1020304078', name: 'Taller', discountType, discountValue });
      await submit();
      expect(host.saved).toEqual([]);
      expect(text()).toContain(message);
    });

    it('edits a customer: shows its data and can deactivate it', async () => {
      const { host, fill, submit, text, fixture } = await render((h) => {
        h.full.set(true);
        h.customer.set(minera);
      });
      const input = (suffix: string) => fixture.nativeElement.querySelector(`input[id$="-${suffix}"]`) as HTMLInputElement;
      expect(input('number').value).toBe('1023456027');
      expect(input('name').value).toBe('Minera Demo Ltda.');
      expect(input('discount-value').value).toBe('10.00');
      expect(text()).toContain('Cliente activo');

      await fill({ active: false });
      await submit();
      expect(host.saved[0]).toMatchObject({
        name: 'Minera Demo Ltda.',
        documentNumber: '1023456027',
        creditEnabled: true,
        discountType: 'PERCENT',
        discountValue: '10.00',
        status: 'INACTIVE',
      });
      expect(host.saved[0].documentType).toBe(5);
    });

    it('starts empty again when the customer is cleared', async () => {
      const { host, fixture, fill } = await render((h) => {
        h.full.set(true);
        h.customer.set(minera);
      });
      host.customer.set(null);
      await fixture.whenStable();
      expect((fixture.nativeElement.querySelector('input[id$="-number"]') as HTMLInputElement).value).toBe('');
      await fill({});
    });
  });
});
