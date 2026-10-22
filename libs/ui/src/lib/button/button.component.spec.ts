import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ButtonComponent } from './button.component';

@Component({
  imports: [ButtonComponent],
  template: `
    <button id="a" rsButton variant="secondary" size="sm" [loading]="true">Guardar</button>
    <button id="b" rsButton>Cotizar</button>
    <a id="c" rsButton variant="danger" size="lg" fill href="/x">Eliminar</a>
    <button id="d" rsButton variant="brand" disabled>Comprar</button>
  `,
})
class HostComponent {}

describe('ButtonComponent', () => {
  async function render() {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('aplica variante, tamaño y estado de carga', async () => {
    const el = (await render()).querySelector('#a') as HTMLButtonElement;
    expect(el.classList).toContain('rs-button');
    expect(el.classList).toContain('rs-button--secondary');
    expect(el.classList).toContain('rs-button--sm');
    expect(el.classList).toContain('rs-button--loading');
    expect(el.getAttribute('aria-busy')).toBe('true');
    expect(el.querySelector('.rs-button__spinner')).not.toBeNull();
    expect(el.textContent).toContain('Guardar');
  });

  it('usa primary + md por defecto y no marca aria-busy', async () => {
    const el = (await render()).querySelector('#b') as HTMLButtonElement;
    expect(el.classList).toContain('rs-button--primary');
    expect(el.classList).toContain('rs-button--md');
    expect(el.getAttribute('aria-busy')).toBeNull();
    expect(el.querySelector('.rs-button__spinner')).toBeNull();
  });

  it('soporta danger, tamaño lg y fill sobre un enlace', async () => {
    const el = (await render()).querySelector('#c') as HTMLAnchorElement;
    expect(el.classList).toContain('rs-button--danger');
    expect(el.classList).toContain('rs-button--lg');
    expect(el.classList).toContain('rs-button--fill');
  });

  it('soporta la variante brand y el atributo disabled nativo', async () => {
    const el = (await render()).querySelector('#d') as HTMLButtonElement;
    expect(el.classList).toContain('rs-button--brand');
    expect(el.disabled).toBe(true);
  });
});
