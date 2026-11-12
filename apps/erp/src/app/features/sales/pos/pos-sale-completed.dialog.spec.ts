import { TestBed } from '@angular/core/testing';
import type { CompletedSale } from '@rodasoft/domain';
import { PosSaleCompletedDialog } from './pos-sale-completed.dialog';

const sale: CompletedSale = {
  saleId: 's1',
  number: 'V-000125',
  createdAt: '2026-10-14T14:42:00.000Z',
  total: '490.00',
  received: '500.00',
  change: '10.00',
  customerName: 'S/N',
  invoiceStatus: 'PENDING',
  customerEmail: null,
  dueDate: null,
};

describe('PosSaleCompletedDialog', () => {
  function render() {
    const fixture = TestBed.createComponent(PosSaleCompletedDialog);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('sale', sale);
    fixture.detectChanges();
    return fixture;
  }

  const button = (root: HTMLElement, label: string) =>
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes(label)) as HTMLButtonElement;

  it('shows the sale and offers Ver venta next to Nueva venta', () => {
    const fixture = render();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('V-000125');
    expect(button(root, 'Ver venta')).toBeTruthy();
    expect(button(root, 'Nueva venta')).toBeTruthy();
  });

  it('shows what was received and the change of a sale paid now', () => {
    const root = render().nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid=sale-received]')?.textContent).toBe('Bs 500,00');
    expect(root.querySelector('[data-testid=sale-change]')?.textContent).toBe('Bs 10,00');
    expect(root.querySelector('[data-testid=sale-credit]')).toBeNull();
  });

  it('shows the balance and the due date instead of received and change on a credit sale (HU-VEN-34)', () => {
    const fixture = TestBed.createComponent(PosSaleCompletedDialog);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('sale', { ...sale, received: '0.00', change: '0.00', dueDate: '2026-11-21' });
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid=sale-credit]')?.textContent).toBe('Bs 490,00');
    expect(root.querySelector('[data-testid=sale-due]')?.textContent).toBe('21/11/2026');
    expect(root.querySelector('[data-testid=sale-received]')).toBeNull();
    expect(root.querySelector('[data-testid=sale-change]')).toBeNull();
    expect(root.textContent).toContain('saldo a crédito registrado');
  });

  it('Ver venta emits viewSale and does not start a new sale', () => {
    const fixture = render();
    const viewed = jest.fn();
    const started = jest.fn();
    fixture.componentInstance.viewSale.subscribe(viewed);
    fixture.componentInstance.newSale.subscribe(started);
    button(fixture.nativeElement, 'Ver venta').click();
    expect(viewed).toHaveBeenCalledTimes(1);
    expect(started).not.toHaveBeenCalled();
  });
});
