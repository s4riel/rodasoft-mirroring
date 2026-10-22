import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BadgeComponent } from './badge.component';

@Component({
  imports: [BadgeComponent],
  template: `<rs-badge>Nuevo</rs-badge><rs-badge variant="out-of-stock">Agotado</rs-badge>`,
})
class HostComponent {}

describe('BadgeComponent', () => {
  it('aplica la variante y muestra el texto', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const badges: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('rs-badge'));
    expect(badges[0].getAttribute('data-variant')).toBe('new');
    expect(badges[1].getAttribute('data-variant')).toBe('out-of-stock');
    expect(badges[1].textContent).toContain('Agotado');
  });
});
