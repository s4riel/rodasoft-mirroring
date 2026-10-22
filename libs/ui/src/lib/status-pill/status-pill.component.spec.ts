import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { StatusPillComponent } from './status-pill.component';

@Component({
  imports: [StatusPillComponent],
  template: `
    <rs-status-pill status="success">Vigente</rs-status-pill>
    <rs-status-pill>Sin configurar</rs-status-pill>
  `,
})
class HostComponent {}

describe('StatusPillComponent', () => {
  it('refleja el estado en data-status y por defecto es idle', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const pills: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('rs-status-pill'));
    expect(pills[0].getAttribute('data-status')).toBe('success');
    expect(pills[0].textContent).toContain('Vigente');
    expect(pills[1].getAttribute('data-status')).toBe('idle');
    expect(pills[0].querySelector('.dot')).not.toBeNull();
  });
});

@Component({
  imports: [StatusPillComponent],
  template: `<rs-status-pill status="warning" icon="alert">Con diferencias</rs-status-pill>`,
})
class IconHostComponent {}

@Component({
  imports: [StatusPillComponent],
  template: `
    <rs-status-pill id="with" status="warning" tooltip="Sello: 2RS → DDU">Con diferencias</rs-status-pill>
    <rs-status-pill id="without" status="success">Exacta</rs-status-pill>
  `,
})
class TooltipHostComponent {}

describe('StatusPillComponent with a tooltip', () => {
  it('is a keyboard stop only when it has a tooltip', async () => {
    const fixture = TestBed.createComponent(TooltipHostComponent);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('#with')?.getAttribute('tabindex')).toBe('0');
    expect(el.querySelector('#without')?.getAttribute('tabindex')).toBeNull();
  });

  it('opens the tooltip on focus', async () => {
    const fixture = TestBed.createComponent(TooltipHostComponent);
    await fixture.whenStable();
    const pill = fixture.nativeElement.querySelector('#with') as HTMLElement;
    pill.dispatchEvent(new Event('focusin'));
    expect(document.body.textContent).toContain('Sello: 2RS → DDU');
    pill.dispatchEvent(new Event('focusout'));
  });
});

describe('StatusPillComponent with a leading icon', () => {
  it('shows the glyph instead of the dot', async () => {
    const fixture = TestBed.createComponent(IconHostComponent);
    await fixture.whenStable();
    const pill: HTMLElement = fixture.nativeElement.querySelector('rs-status-pill');
    expect(pill.querySelector('rs-icon')?.getAttribute('aria-hidden')).toBe('true');
    expect(pill.querySelector('.dot')).toBeNull();
    expect(pill.textContent).toContain('Con diferencias');
  });
});
