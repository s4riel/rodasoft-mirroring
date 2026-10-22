import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { KpiCardComponent } from './kpi-card.component';

@Component({
  imports: [KpiCardComponent],
  template: `
    <rs-kpi-card label="Ventas del mes" value="Bs 128.450,00" trend="positive" note="+12% vs. mes anterior">
      <b class="extra">extra</b>
    </rs-kpi-card>
    <rs-kpi-card label="Precio" value="Bs 245,00" />
    <rs-kpi-card label="Ventas" value="Bs 1,00" trend="negative" note="−8% vs. mes anterior" disabled />
  `,
})
class HostComponent {}

describe('KpiCardComponent', () => {
  async function render() {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    return Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('rs-kpi-card'));
  }

  it('shows title, value, trend line and projected content', async () => {
    const [first, second] = await render();
    expect(first.querySelector('.label')?.textContent).toBe('Ventas del mes');
    expect(first.querySelector('.value')?.textContent).toBe('Bs 128.450,00');
    expect(first.querySelector('.note')?.textContent).toBe('+12% vs. mes anterior');
    expect(first.querySelector('.extra')).not.toBeNull();
    expect(second.querySelector('.note')).toBeNull();
  });

  it('mirrors the trend (neutral by default) and the disabled state', async () => {
    const [first, second, third] = await render();
    expect(first.getAttribute('data-trend')).toBe('positive');
    expect(second.getAttribute('data-trend')).toBe('neutral');
    expect(third.getAttribute('data-trend')).toBe('negative');
    expect(third.getAttribute('aria-disabled')).toBe('true');
    expect(first.getAttribute('aria-disabled')).toBeNull();
  });
});
