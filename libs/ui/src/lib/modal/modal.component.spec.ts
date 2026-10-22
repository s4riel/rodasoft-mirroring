import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ModalComponent } from './modal.component';

@Component({
  imports: [ModalComponent],
  template: `
    <button id="opener" (click)="open.set(true)">Abrir</button>
    <rs-modal [(open)]="open" heading="Anular factura" variant="form" (closed)="closedCount = closedCount + 1">
      <input id="field" />
      <div slot="footer"><button id="cancel">Cancelar</button><button id="confirm">Anular</button></div>
    </rs-modal>
  `,
})
class HostComponent {
  readonly open = signal(false);
  closedCount = 0;
}

describe('ModalComponent', () => {
  async function openModal() {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    fixture.componentInstance.open.set(true);
    await fixture.whenStable();
    return fixture;
  }

  it('no renderiza nada cerrado y abre como dialog modal con título', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();

    fixture.componentInstance.open.set(true);
    await fixture.whenStable();
    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('data-variant')).toBe('form');
    const title = dialog.querySelector('h2') as HTMLElement;
    expect(title.textContent).toBe('Anular factura');
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id);
  });

  it('enfoca el primer control del cuerpo al abrir', async () => {
    const fixture = await openModal();
    await fixture.whenStable();
    expect(document.activeElement?.id).toBe('field');
  });

  it('cierra con ESC y emite closed', async () => {
    const fixture = await openModal();
    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();
    expect(fixture.componentInstance.open()).toBe(false);
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
    expect(fixture.componentInstance.closedCount).toBe(1);
  });

  it('cierra al hacer clic en el fondo pero no dentro del panel', async () => {
    const fixture = await openModal();
    const root: HTMLElement = fixture.nativeElement;
    (root.querySelector('.panel') as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await fixture.whenStable();
    expect(fixture.componentInstance.open()).toBe(true);

    (root.querySelector('.backdrop') as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await fixture.whenStable();
    expect(fixture.componentInstance.open()).toBe(false);
  });

  it('atrapa el foco con Tab en el último control', async () => {
    const fixture = await openModal();
    const root: HTMLElement = fixture.nativeElement;
    const dialog = root.querySelector('[role="dialog"]') as HTMLElement;
    const confirm = root.querySelector('#confirm') as HTMLButtonElement;
    confirm.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    dialog.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(root.querySelector('.close'));
  });

  it('bloquea el scroll del body mientras está abierto', async () => {
    const fixture = await openModal();
    expect(document.body.style.overflow).toBe('hidden');
    fixture.componentInstance.open.set(false);
    await fixture.whenStable();
    expect(document.body.style.overflow).not.toBe('hidden');
  });
});
