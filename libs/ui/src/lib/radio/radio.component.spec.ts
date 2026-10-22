import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RadioComponent, RadioGroupComponent } from './radio.component';

@Component({
  imports: [RadioComponent, RadioGroupComponent, ReactiveFormsModule],
  template: `
    <rs-radio-group id="g" ariaLabel="Entrega" [formControl]="control">
      <rs-radio id="r1" value="pickup">Retiro en sucursal</rs-radio>
      <rs-radio id="r2" value="delivery">Envío a domicilio</rs-radio>
      <rs-radio id="r3" value="x" disabled>No disponible</rs-radio>
    </rs-radio-group>
    <rs-radio id="solo" [checked]="true">Suelta</rs-radio>
  `,
})
class HostComponent {
  readonly control = new FormControl<string | null>('pickup');
}

describe('RadioGroupComponent / RadioComponent', () => {
  async function setup() {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const input = (id: string) => el.querySelector(`#${id} input`) as HTMLInputElement;
    return { fixture, el, input, host: fixture.componentInstance };
  }

  it('el grupo expone role radiogroup y comparte el name', async () => {
    const { el, input } = await setup();
    const group = el.querySelector('#g') as HTMLElement;
    expect(group.getAttribute('role')).toBe('radiogroup');
    expect(group.getAttribute('aria-label')).toBe('Entrega');
    expect(input('r1').name).toBeTruthy();
    expect(input('r1').name).toBe(input('r2').name);
  });

  it('marca la opción del valor inicial', async () => {
    const { input } = await setup();
    expect(input('r1').checked).toBe(true);
    expect(input('r2').checked).toBe(false);
  });

  it('seleccionar otra opción escribe el valor al FormControl', async () => {
    const { fixture, input, host } = await setup();
    input('r2').click();
    await fixture.whenStable();
    expect(host.control.value).toBe('delivery');
    expect(input('r1').checked).toBe(false);
    expect(input('r2').checked).toBe(true);
  });

  it('writeValue y disabled por opción', async () => {
    const { fixture, input, host } = await setup();
    host.control.setValue('delivery');
    await fixture.whenStable();
    expect(input('r2').checked).toBe(true);
    expect(input('r3').disabled).toBe(true);
  });

  it('el radio suelto usa checked', async () => {
    const { input } = await setup();
    expect(input('solo').checked).toBe(true);
  });
});
