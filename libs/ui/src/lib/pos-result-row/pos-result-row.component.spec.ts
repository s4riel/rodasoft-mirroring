import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PosResultRowComponent, type PosResultStockLevel } from './pos-result-row.component';

@Component({
  imports: [PosResultRowComponent],
  template: `
    <rs-pos-result-row
      code="6205-2RS"
      description="Rodamiento rígido de bolas · SKF"
      brandInitials="SK"
      [stockLabel]="stockLabel()"
      [stockLevel]="level()"
      price="Bs 245,00"
      addLabel="Agregar"
      [showDetail]="showDetail()"
      detailLabel="Ver ficha"
      [showEquivalents]="showEquivalents()"
      equivalentsLabel="Equivalentes"
      (add)="added = added + 1"
      (detail)="details = details + 1"
      (equivalents)="equivalents = equivalents + 1"
    />
  `,
})
class HostComponent {
  readonly stockLabel = signal('24 en Central');
  readonly level = signal<PosResultStockLevel>('ok');
  readonly showDetail = signal(false);
  readonly showEquivalents = signal(false);
  added = 0;
  details = 0;
  equivalents = 0;
}

describe('PosResultRowComponent', () => {
  async function render() {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const el = (): HTMLElement => fixture.nativeElement.querySelector('rs-pos-result-row');
    const buttons = () => Array.from(el().querySelectorAll<HTMLButtonElement>('button'));
    return { fixture, host: fixture.componentInstance, el, buttons };
  }

  it('shows the code, the brand monogram, the stock and the price', async () => {
    const { el } = await render();
    expect(el().querySelector('.code')?.textContent).toBe('6205-2RS');
    expect(el().querySelector('.mark')?.textContent?.trim()).toBe('SK');
    expect(el().querySelector('.stock-label')?.textContent).toBe('24 en Central');
    expect(el().querySelector('.price')?.textContent).toBe('Bs 245,00');
    expect(el().querySelector('rs-stock-flag')).toBeNull();
  });

  it('emits add from the Agregar button', async () => {
    const { host, buttons } = await render();
    expect(buttons().map((b) => b.textContent?.trim())).toEqual(['Agregar']);
    buttons()[0].click();
    expect(host.added).toBe(1);
  });

  it('flags low stock with the warning flag', async () => {
    const { fixture, host, el } = await render();
    host.level.set('low');
    host.stockLabel.set('3 en Central');
    await fixture.whenStable();
    expect(el().querySelector('rs-stock-flag')?.getAttribute('data-level')).toBe('low');
  });

  it('shows "Agotado aquí" with the danger flag and a disabled Agregar when out of stock', async () => {
    const { fixture, host, el, buttons } = await render();
    host.level.set('out');
    host.stockLabel.set('Agotado aquí');
    await fixture.whenStable();
    expect(el().getAttribute('data-stock')).toBe('out');
    expect(el().querySelector('rs-stock-flag')?.getAttribute('data-level')).toBe('out');
    expect(el().querySelector('.stock-label')?.textContent).toBe('Agotado aquí');
    expect(buttons()[0].disabled).toBe(true);
  });

  it('swaps the action for Equivalentes when out of stock and enabled', async () => {
    const { fixture, host, buttons } = await render();
    host.level.set('out');
    host.showEquivalents.set(true);
    await fixture.whenStable();
    expect(buttons().map((b) => b.textContent?.trim())).toEqual(['Equivalentes']);
    buttons()[0].click();
    expect(host.equivalents).toBe(1);
  });

  it('shows the eye button only with showDetail', async () => {
    const { fixture, host, buttons } = await render();
    host.showDetail.set(true);
    await fixture.whenStable();
    const eye = buttons()[0];
    expect(eye.getAttribute('aria-label')).toBe('Ver ficha');
    eye.click();
    expect(host.details).toBe(1);
  });
});
