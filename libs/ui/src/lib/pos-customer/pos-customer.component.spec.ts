import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { PosCustomerType } from './pos-customer.component';
import { PosCustomerComponent } from './pos-customer.component';

@Component({
  imports: [PosCustomerComponent],
  template: `
    <rs-pos-customer
      [type]="type()"
      [name]="name()"
      [detail]="detail()"
      [actionLabel]="actionLabel()"
      actionAriaLabel="Cambiar cliente"
      [disabled]="disabled()"
      (action)="actions = actions + 1"
    />
  `,
})
class HostComponent {
  readonly type = signal<PosCustomerType>('final');
  readonly name = signal('Consumidor final');
  readonly detail = signal('Sin NIT · factura a S/N');
  readonly actionLabel = signal('Agregar NIT');
  readonly disabled = signal(false);
  actions = 0;
}

describe('PosCustomerComponent', () => {
  async function render() {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const el = (): HTMLElement => fixture.nativeElement.querySelector('rs-pos-customer');
    return { fixture, host: fixture.componentInstance, el };
  }

  it('shows the final consumer with its detail and the action (Type=Final)', async () => {
    const { el } = await render();
    expect(el().getAttribute('data-type')).toBe('final');
    expect(el().querySelector('.name')?.textContent).toBe('Consumidor final');
    expect(el().querySelector('.detail')?.textContent).toBe('Sin NIT · factura a S/N');
    expect(el().querySelector('button')?.textContent?.trim()).toBe('Agregar NIT');
  });

  it('shows an identified customer (Type=Identified)', async () => {
    const { fixture, host, el } = await render();
    host.type.set('identified');
    host.name.set('Minera Demo Ltda.');
    host.detail.set('NIT 1023456027 · compras@minerademo.bo');
    host.actionLabel.set('Cambiar');
    await fixture.whenStable();
    expect(el().getAttribute('data-type')).toBe('identified');
    expect(el().querySelector('.name')?.textContent).toBe('Minera Demo Ltda.');
    expect(el().querySelector('button')?.textContent?.trim()).toBe('Cambiar');
  });

  it('leaves out the second line without a detail', async () => {
    const { fixture, host, el } = await render();
    host.detail.set('');
    await fixture.whenStable();
    expect(el().querySelector('.detail')).toBeNull();
  });

  it('disables the action without an open register', async () => {
    const { fixture, host, el } = await render();
    host.disabled.set(true);
    await fixture.whenStable();
    expect((el().querySelector('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('emits the action and gives the button its accessible name', async () => {
    const { host, el } = await render();
    const button = el().querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Cambiar cliente');
    button.click();
    expect(host.actions).toBe(1);
  });
});
