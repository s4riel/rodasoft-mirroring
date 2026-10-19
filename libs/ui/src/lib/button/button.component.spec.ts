import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ButtonComponent } from './button.component';

@Component({
  imports: [ButtonComponent],
  template: `<button rsButton variant="secondary" size="sm" [loading]="true">Guardar</button>`,
})
class HostComponent {}

describe('ButtonComponent', () => {
  it('aplica variante, tamaño y estado de carga', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const el: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(el.classList).toContain('rs-button--secondary');
    expect(el.classList).toContain('rs-button--sm');
    expect(el.getAttribute('aria-busy')).toBe('true');
    expect(el.textContent).toContain('Guardar');
  });
});
