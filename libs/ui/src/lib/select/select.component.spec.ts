import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { SelectComponent, SelectOption } from './select.component';

const OPTIONS: SelectOption<string>[] = [
  { value: 'central', label: 'Sucursal central' },
  { value: 'norte', label: 'Sucursal norte', disabled: true },
  { value: 'sur', label: 'Sucursal sur' },
];

@Component({
  imports: [SelectComponent, ReactiveFormsModule],
  template: `
    <rs-select id="a" inputId="branch" placeholder="Selecciona" [options]="options" [formControl]="control" />
    <rs-select id="b" [options]="options" [open]="true" [invalid]="true" [value]="'sur'" />
    <rs-select id="c" [options]="options" disabled />
  `,
})
class HostComponent {
  readonly options = OPTIONS;
  readonly control = new FormControl<string | null>(null);
}

describe('SelectComponent', () => {
  async function setup() {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const trigger = (id: string) => el.querySelector(`#${id} button`) as HTMLButtonElement;
    const key = async (id: string, k: string) => {
      trigger(id).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      await fixture.whenStable();
    };
    return { fixture, el, trigger, key, host: fixture.componentInstance };
  }

  it('muestra el placeholder y expone roles ARIA', async () => {
    const { trigger } = await setup();
    const button = trigger('a');
    expect(button.getAttribute('role')).toBe('combobox');
    expect(button.getAttribute('id')).toBe('branch');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.textContent).toContain('Selecciona');
  });

  it('abre con clic, marca la seleccionada y lista las opciones', async () => {
    const { el, trigger } = await setup();
    const panel = el.querySelector('#b ul[role="listbox"]') as HTMLElement;
    expect(panel).not.toBeNull();
    const options = panel.querySelectorAll('[role="option"]');
    expect(options.length).toBe(3);
    expect(options[2].getAttribute('aria-selected')).toBe('true');
    expect(options[1].getAttribute('aria-disabled')).toBe('true');
    expect(trigger('b').getAttribute('aria-invalid')).toBe('true');
  });

  it('navega con teclado, salta opciones deshabilitadas y escribe al FormControl', async () => {
    const { el, trigger, key, host } = await setup();
    await key('a', 'ArrowDown'); // opens, active = first
    expect(trigger('a').getAttribute('aria-expanded')).toBe('true');
    await key('a', 'ArrowDown'); // skips disabled "norte" -> sur
    const active = el.querySelector('#a .option.active') as HTMLElement;
    expect(active.textContent).toContain('Sucursal sur');
    await key('a', 'Enter');
    expect(host.control.value).toBe('sur');
    expect(trigger('a').getAttribute('aria-expanded')).toBe('false');
    expect(trigger('a').textContent).toContain('Sucursal sur');
  });

  it('Escape cierra sin cambiar el valor', async () => {
    const { trigger, key, host } = await setup();
    await key('a', 'Enter');
    expect(trigger('a').getAttribute('aria-expanded')).toBe('true');
    await key('a', 'Escape');
    expect(trigger('a').getAttribute('aria-expanded')).toBe('false');
    expect(host.control.value).toBeNull();
  });

  it('writeValue desde el FormControl actualiza la etiqueta', async () => {
    const { fixture, trigger, host } = await setup();
    host.control.setValue('central');
    await fixture.whenStable();
    expect(trigger('a').textContent).toContain('Sucursal central');
  });

  it('respeta disabled', async () => {
    const { trigger } = await setup();
    expect(trigger('c').disabled).toBe(true);
  });
});
