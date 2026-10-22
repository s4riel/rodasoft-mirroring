import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { StockFlagComponent } from './stock-flag.component';

@Component({
  imports: [StockFlagComponent],
  template: `
    <rs-stock-flag level="low" label="Stock bajo" />
    <rs-stock-flag level="out" />
  `,
})
class HostComponent {}

describe('StockFlagComponent', () => {
  async function render() {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    return Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('rs-stock-flag'));
  }

  it('draws the alert glyph and mirrors the level', async () => {
    const flags = await render();
    expect(flags.map((f) => f.getAttribute('data-level'))).toEqual(['low', 'out']);
    expect(flags[0].querySelector('rs-icon')).not.toBeNull();
  });

  it('is named with a label and decorative without it', async () => {
    const flags = await render();
    expect(flags[0].getAttribute('role')).toBe('img');
    expect(flags[0].getAttribute('aria-label')).toBe('Stock bajo');
    expect(flags[1].getAttribute('aria-hidden')).toBe('true');
    expect(flags[1].getAttribute('role')).toBeNull();
  });
});
