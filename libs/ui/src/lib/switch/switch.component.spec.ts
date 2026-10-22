import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { SwitchComponent } from './switch.component';

@Component({
  imports: [SwitchComponent, ReactiveFormsModule],
  template: `
    <rs-switch id="a" onText="Activado" offText="Desactivado" [formControl]="control">Solo disponibles</rs-switch>
    <rs-switch id="b" [checked]="true" disabled>Bloqueado</rs-switch>
  `,
})
class HostComponent {
  readonly control = new FormControl(false, { nonNullable: true });
}

describe('SwitchComponent', () => {
  async function setup() {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const input = (id: string) => el.querySelector(`#${id} input`) as HTMLInputElement;
    return { fixture, el, input, host: fixture.componentInstance };
  }

  it('usa role switch y muestra el texto de estado apagado', async () => {
    const { el, input } = await setup();
    expect(input('a').getAttribute('role')).toBe('switch');
    expect(input('a').getAttribute('aria-checked')).toBe('false');
    expect(el.querySelector('#a .status')?.textContent).toContain('Desactivado');
    expect(el.querySelector('#a')?.textContent).toContain('Solo disponibles');
  });

  it('al alternar actualiza el FormControl, aria-checked y el texto', async () => {
    const { fixture, el, input, host } = await setup();
    input('a').click();
    await fixture.whenStable();
    expect(host.control.value).toBe(true);
    expect(input('a').getAttribute('aria-checked')).toBe('true');
    expect(el.querySelector('#a .status')?.textContent).toContain('Activado');
  });

  it('writeValue y disabled', async () => {
    const { fixture, el, input, host } = await setup();
    host.control.setValue(true);
    await fixture.whenStable();
    expect(input('a').checked).toBe(true);
    expect(input('b').disabled).toBe(true);
    expect(el.querySelector('#b .status')).toBeNull();
  });
});
