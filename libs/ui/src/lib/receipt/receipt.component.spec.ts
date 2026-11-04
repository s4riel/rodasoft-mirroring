import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ReceiptComponent, type ReceiptPaper } from './receipt.component';

@Component({
  imports: [ReceiptComponent],
  template: `
    <rs-receipt
      [paper]="paper()"
      title="Rodalaser"
      [headerLines]="['Rodalaser S.R.L.', 'NIT 1020304050']"
      [metaRows]="[{ label: 'Comprobante', value: 'V-000125' }]"
      [items]="[{ description: '6205-2RS · Rodamiento', detail: '2 × Bs 245,00', total: 'Bs 490,00' }]"
      [totalRows]="[
        { label: 'Subtotal', value: 'Bs 490,00' },
        { label: 'Total', value: 'Bs 490,00', strong: true }
      ]"
      [footerLines]="['Gracias por su compra.']"
    />
  `,
})
class HostComponent {
  readonly paper = signal<ReceiptPaper>('ticket-80mm');
}

describe('ReceiptComponent', () => {
  async function render() {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const el = (): HTMLElement => fixture.nativeElement.querySelector('rs-receipt');
    return { fixture, host: fixture.componentInstance, el };
  }

  it('prints the title, header lines and notes', async () => {
    const { el } = await render();
    expect(el().querySelector('.title')?.textContent).toBe('Rodalaser');
    expect(Array.from(el().querySelectorAll('.head .line')).map((l) => l.textContent)).toEqual(['Rodalaser S.R.L.', 'NIT 1020304050']);
    expect(el().querySelector('.foot .line')?.textContent).toBe('Gracias por su compra.');
  });

  it('prints each sold line with its detail and total', async () => {
    const { el } = await render();
    const item = el().querySelector('.item');
    expect(item?.querySelector('.description')?.textContent).toBe('6205-2RS · Rodamiento');
    expect(item?.querySelector('.detail')?.textContent).toBe('2 × Bs 245,00');
    expect(item?.querySelector('.total')?.textContent).toBe('Bs 490,00');
  });

  it('prints the meta data and the totals, the sale total standing out', async () => {
    const { el } = await render();
    expect(el().querySelector('.meta dt')?.textContent).toBe('Comprobante');
    expect(el().querySelector('.meta dd')?.textContent).toBe('V-000125');
    const totals = el().querySelectorAll('.totals .row');
    expect(totals).toHaveLength(2);
    expect(totals[0].classList.contains('strong')).toBe(false);
    expect(totals[1].classList.contains('strong')).toBe(true);
  });

  it('follows the paper input', async () => {
    const { fixture, host, el } = await render();
    expect(el().getAttribute('data-paper')).toBe('ticket-80mm');
    host.paper.set('letter');
    await fixture.whenStable();
    expect(el().getAttribute('data-paper')).toBe('letter');
  });
});
