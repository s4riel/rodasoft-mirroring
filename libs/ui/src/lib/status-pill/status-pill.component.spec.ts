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
