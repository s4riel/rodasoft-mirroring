import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TransferDifferencesDialog } from './transfer-differences.dialog';
import type { ReceiptLineState } from './transfer-receipt';

const line = (over: Partial<ReceiptLineState>): ReceiptLineState => ({
  productId: 'a',
  code: '6204-2RS',
  name: 'Rodamiento',
  brand: 'SKF',
  sent: 10,
  received: 0,
  counted: 0,
  unitCost: '5.0000',
  ...over,
});

@Component({
  imports: [TransferDifferencesDialog],
  template: `<rs-transfer-differences-dialog [(open)]="open" [lines]="lines()" [busy]="busy()" [error]="error()" (confirmed)="confirmed.push($event)" />`,
})
class Host {
  readonly open = signal(true);
  readonly lines = signal<ReceiptLineState[]>([]);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly confirmed: Record<string, number>[] = [];
}

describe('TransferDifferencesDialog', () => {
  function create(lines: ReceiptLineState[]) {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.lines.set(lines);
    fixture.detectChanges();
    return fixture;
  }
  const text = (f: { nativeElement: HTMLElement }) => f.nativeElement.textContent ?? '';
  const confirmButton = (f: { nativeElement: HTMLElement }) =>
    Array.from(f.nativeElement.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Confirmar') as HTMLButtonElement;

  it('lists the shortage with its value and says an adjustment will be pending', () => {
    const f = create([line({ productId: 'a', sent: 10, counted: 8 }), line({ productId: 'b', code: '6205-ZZ', sent: 3, counted: 3 })]);
    expect(text(f)).toContain('Faltante');
    expect(text(f)).toContain('-2');
    expect(text(f)).toContain('10,00');
    expect(text(f)).not.toContain('6205-ZZ ·');
    expect(text(f)).toContain('Se generará un ajuste pendiente de aprobación');
  });

  it('says there are no differences, and no adjustment, when everything matched', () => {
    const f = create([line({ sent: 4, counted: 4 })]);
    expect(text(f)).toContain('Sin diferencias');
    expect(text(f)).not.toContain('Se generará un ajuste');
  });

  it('adds the surplus typed for a product received in full and confirms it', () => {
    const f = create([line({ productId: 'a', sent: 4, counted: 4 })]);
    const dialog = f.debugElement.children[0].componentInstance as { selectProduct(v: unknown): void };
    dialog.selectProduct('a');
    f.detectChanges();
    const quantity = f.nativeElement.querySelector('#surplus-quantity') as HTMLInputElement;
    quantity.value = '2';
    quantity.dispatchEvent(new Event('input'));
    f.detectChanges();
    expect(text(f)).toContain('Sobrante');
    expect(text(f)).toContain('+2');

    confirmButton(f).click();
    expect(f.componentInstance.confirmed).toEqual([{ a: 2 }]);
  });

  it('shows the error of a failed close', () => {
    const f = create([line({ sent: 4, counted: 4 })]);
    f.componentInstance.error.set('Otro usuario modificó esta transferencia.');
    f.detectChanges();
    expect(text(f)).toContain('Otro usuario modificó esta transferencia.');
  });
});
