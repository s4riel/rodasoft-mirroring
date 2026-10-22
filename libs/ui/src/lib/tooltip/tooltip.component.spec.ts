import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TooltipComponent } from './tooltip.component';
import { TooltipDirective } from './tooltip.directive';

@Component({
  imports: [TooltipDirective, TooltipComponent],
  template: `
    <button id="trigger" rsTooltip="Copiar código" rsTooltipPosition="bottom">Copiar</button>
    <rs-tooltip id="static" text="Estático" />
  `,
})
class HostComponent {}

describe('TooltipDirective', () => {
  it('muestra el globo con foco, enlaza aria-describedby y lo cierra con ESC', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const trigger = fixture.nativeElement.querySelector('#trigger') as HTMLButtonElement;

    trigger.dispatchEvent(new Event('focusin'));
    const tip = document.body.querySelector(
      'rs-tooltip[role="tooltip"][data-position="bottom"]',
    ) as HTMLElement;
    expect(tip).not.toBeNull();
    expect(tip.textContent).toContain('Copiar código');
    expect(trigger.getAttribute('aria-describedby')).toBe(tip.id);

    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.body.querySelector('#' + tip.id)).toBeNull();
    expect(trigger.hasAttribute('aria-describedby')).toBe(false);
  });

  it('se cierra al salir el mouse y el componente estático renderiza su texto', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const trigger = fixture.nativeElement.querySelector('#trigger') as HTMLButtonElement;
    trigger.dispatchEvent(new Event('mouseenter'));
    expect(document.body.querySelectorAll('rs-tooltip').length).toBeGreaterThanOrEqual(2);
    trigger.dispatchEvent(new Event('mouseleave'));
    expect(trigger.hasAttribute('aria-describedby')).toBe(false);
    expect(fixture.nativeElement.querySelector('#static').textContent).toContain('Estático');
  });
});
