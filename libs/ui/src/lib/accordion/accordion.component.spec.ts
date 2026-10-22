import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AccordionComponent } from './accordion.component';

@Component({
  imports: [AccordionComponent],
  template: `
    <rs-accordion title="Envíos" [(open)]="open">Contenido</rs-accordion>
    <rs-accordion title="Devoluciones" disabled>Otro</rs-accordion>
  `,
})
class HostComponent {
  open = signal(false);
}

describe('AccordionComponent', () => {
  it('toggles the panel and aria-expanded', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const trigger = el.querySelector('button') as HTMLButtonElement;
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('[role="region"]')).toBeNull();
    trigger.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.open()).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelector('[role="region"]')?.textContent).toContain('Contenido');
    expect(trigger.getAttribute('aria-controls')).toBe(el.querySelector('[role="region"]')?.id);
  });

  it('does not toggle when disabled', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const buttons = fixture.nativeElement.querySelectorAll('button');
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true);
  });
});
