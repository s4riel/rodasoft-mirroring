import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FieldComponent } from './field.component';

@Component({
  imports: [FieldComponent],
  template: `
    <rs-field label="Código" forId="code" [hint]="hint()" [error]="error()" required>
      <input id="code" />
      <a rsFieldAction href="#">Ayuda</a>
    </rs-field>
  `,
})
class HostComponent {
  readonly hint = signal<string | undefined>('Ingresa la referencia');
  readonly error = signal<string | null>(null);
}

describe('FieldComponent', () => {
  async function setup() {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement, host: fixture.componentInstance };
  }

  it('muestra etiqueta enlazada al control, marcador de requerido y ayuda', async () => {
    const { el } = await setup();
    const label = el.querySelector('label') as HTMLLabelElement;
    expect(label.getAttribute('for')).toBe('code');
    expect(label.textContent).toContain('Código');
    expect(label.querySelector('.required')).not.toBeNull();
    expect(el.querySelector('#code-hint')?.textContent).toContain('Ingresa la referencia');
    expect(el.querySelector('#code-error')).toBeNull();
    expect(el.querySelector('rs-field')?.classList).not.toContain('has-error');
  });

  it('proyecta el control y la acción de la etiqueta', async () => {
    const { el } = await setup();
    expect(el.querySelector('rs-field input#code')).not.toBeNull();
    expect(el.querySelector('.head a')?.textContent).toContain('Ayuda');
  });

  it('el error reemplaza la ayuda, marca has-error y enlaza aria-describedby', async () => {
    const { fixture, el, host } = await setup();
    host.error.set('Valor inválido');
    await fixture.whenStable();
    const input = el.querySelector('#code') as HTMLInputElement;
    expect(el.querySelector('#code-error')?.getAttribute('role')).toBe('alert');
    expect(el.querySelector('#code-hint')).toBeNull();
    expect(el.querySelector('rs-field')?.classList).toContain('has-error');
    expect(input.getAttribute('aria-describedby')).toBe('code-error');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });
});
