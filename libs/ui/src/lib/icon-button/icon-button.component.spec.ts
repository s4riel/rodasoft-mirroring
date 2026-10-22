import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { IconButtonComponent } from './icon-button.component';

@Component({
  imports: [IconButtonComponent],
  template: `
    <button id="a" rsIconButton label="Buscar" size="lg" type="button"><span>i</span></button>
    <button id="b" rsIconButton label="Cerrar" disabled><span>i</span></button>
  `,
})
class HostComponent {}

describe('IconButtonComponent', () => {
  async function render() {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('expone nombre accesible y tamaño', async () => {
    const el = (await render()).querySelector('#a') as HTMLButtonElement;
    expect(el.getAttribute('aria-label')).toBe('Buscar');
    expect(el.classList).toContain('rs-icon-button--lg');
    expect(el.querySelector('span')).not.toBeNull();
  });

  it('usa md por defecto y respeta disabled', async () => {
    const el = (await render()).querySelector('#b') as HTMLButtonElement;
    expect(el.classList).toContain('rs-icon-button--md');
    expect(el.disabled).toBe(true);
  });
});
