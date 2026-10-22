import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { CheckboxComponent } from './checkbox.component';

@Component({
  imports: [CheckboxComponent, ReactiveFormsModule],
  template: `
    <rs-checkbox id="a" [formControl]="control">Incluir ficha técnica</rs-checkbox>
    <rs-checkbox id="b" [checked]="true" disabled>Fija</rs-checkbox>
  `,
})
class HostComponent {
  readonly control = new FormControl(false, { nonNullable: true });
}

describe('CheckboxComponent', () => {
  async function setup() {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const input = (id: string) => el.querySelector(`#${id} input`) as HTMLInputElement;
    return { fixture, el, input, host: fixture.componentInstance };
  }

  it('renderiza la etiqueta proyectada y empieza desmarcado', async () => {
    const { el, input } = await setup();
    expect(el.querySelector('#a')?.textContent).toContain('Incluir ficha técnica');
    expect(input('a').checked).toBe(false);
    expect(el.querySelector('#a rs-icon')).toBeNull();
  });

  it('escribe true/false al FormControl y muestra el check', async () => {
    const { fixture, el, input, host } = await setup();
    input('a').click();
    await fixture.whenStable();
    expect(host.control.value).toBe(true);
    expect(el.querySelector('#a rs-icon')).not.toBeNull();
    input('a').click();
    await fixture.whenStable();
    expect(host.control.value).toBe(false);
  });

  it('writeValue actualiza el estado visual', async () => {
    const { fixture, input, host } = await setup();
    host.control.setValue(true);
    await fixture.whenStable();
    expect(input('a').checked).toBe(true);
  });

  it('respeta disabled y checked inicial', async () => {
    const { input } = await setup();
    expect(input('b').disabled).toBe(true);
    expect(input('b').checked).toBe(true);
  });
});
