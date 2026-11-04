import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PosCartLineComponent } from './pos-cart-line.component';

@Component({
  imports: [PosCartLineComponent],
  template: `
    <rs-pos-cart-line
      title="6205-2RS · SKF"
      unitPrice="Bs 245,00 c/u"
      [(quantity)]="quantity"
      [max]="max()"
      total="Bs 490,00"
      [discountLabel]="discount()"
      removeLabel="Quitar 6205-2RS"
      quantityLabel="Cantidad"
      decrementLabel="Restar uno"
      incrementLabel="Sumar uno"
      (remove)="removed = removed + 1"
    />
  `,
})
class HostComponent {
  readonly quantity = signal(2);
  readonly max = signal<number | null>(3);
  readonly discount = signal('');
  removed = 0;
}

describe('PosCartLineComponent', () => {
  async function render() {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const el = (): HTMLElement => fixture.nativeElement.querySelector('rs-pos-cart-line');
    const button = (label: string) => el().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) as HTMLButtonElement;
    return { fixture, host: fixture.componentInstance, el, button };
  }

  it('shows the product, unit price, quantity and line total', async () => {
    const { el } = await render();
    expect(el().querySelector('.title')?.textContent).toBe('6205-2RS · SKF');
    expect(el().querySelector('.unit')?.textContent).toBe('Bs 245,00 c/u');
    expect(el().querySelector<HTMLInputElement>('input')?.value).toBe('2');
    expect(el().querySelector('.total')?.textContent).toBe('Bs 490,00');
    expect(el().getAttribute('data-state')).toBe('default');
  });

  it('changes the quantity two-way through the stepper, up to the max', async () => {
    const { fixture, host, button } = await render();
    button('Sumar uno').click();
    await fixture.whenStable();
    expect(host.quantity()).toBe(3);
    expect(button('Sumar uno').disabled).toBe(true);
    button('Restar uno').click();
    expect(host.quantity()).toBe(2);
  });

  it('emits remove from the trash button', async () => {
    const { host, button } = await render();
    button('Quitar 6205-2RS').click();
    expect(host.removed).toBe(1);
  });

  it('shows the discount line in State=Discount', async () => {
    const { fixture, host, el } = await render();
    host.discount.set('−5 % · −Bs 19,00');
    await fixture.whenStable();
    expect(el().getAttribute('data-state')).toBe('discount');
    expect(el().querySelector('.discount')?.textContent).toBe('−5 % · −Bs 19,00');
  });
});
