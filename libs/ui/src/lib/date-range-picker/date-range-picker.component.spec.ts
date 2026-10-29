import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DateRangeValue } from './date-range';
import { DateRangePickerComponent } from './date-range-picker.component';

@Component({
  imports: [DateRangePickerComponent],
  template: `<rs-date-range-picker placeholder="Fecha" ariaLabel="Fecha" today="2023-10-13" [(value)]="range" />`,
})
class HostComponent {
  range = signal<DateRangeValue>({ from: null, to: null });
}

describe('DateRangePickerComponent', () => {
  async function setup(initial?: DateRangeValue) {
    const fixture = TestBed.createComponent(HostComponent);
    if (initial) fixture.componentInstance.range.set(initial);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const click = async (node: Element | null | undefined) => {
      (node as HTMLElement).click();
      await fixture.whenStable();
    };
    const byText = (selector: string, text: string) =>
      Array.from(el.querySelectorAll(selector)).find((n) => n.textContent?.trim() === text);
    return { fixture, el, click, byText };
  }

  it('shows the placeholder, then the applied range', async () => {
    const { el } = await setup({ from: '2023-10-02', to: '2023-10-08' });
    expect(el.querySelector('.value')?.textContent).toContain('02/10/2023 – 08/10/2023');
    const empty = await setup();
    expect(empty.el.querySelector('.value')?.textContent).toContain('Fecha');
  });

  it('opens on the month of today with the Spanish names', async () => {
    const { el, click } = await setup();
    await click(el.querySelector('.control'));
    expect(el.querySelector('.month-title')?.textContent).toBe('Octubre 2023');
    expect(el.querySelector('.weekdays')?.textContent).toContain('Lun');
    expect(el.querySelector('.weekdays')?.textContent).toContain('Dom');
    expect(el.querySelector('.presets')?.textContent).toContain('Semana pasada');
    expect(el.querySelector('.apply')?.textContent).toContain('Aplicar');
  });

  it('applies the last-week preset only on "Aplicar"', async () => {
    const { fixture, el, click, byText } = await setup();
    await click(el.querySelector('.control'));
    await click(byText('.preset', 'Semana pasada'));
    expect(el.querySelectorAll('.day.in-range')).toHaveLength(7);
    expect(fixture.componentInstance.range()).toEqual({ from: null, to: null });
    await click(el.querySelector('.apply'));
    expect(fixture.componentInstance.range()).toEqual({ from: '2023-10-02', to: '2023-10-08' });
    expect(el.querySelector('.panel')).toBeNull();
  });

  it('picks a custom range with two days and moves between months', async () => {
    const { fixture, el, click, byText } = await setup();
    await click(el.querySelector('.control'));
    expect((el.querySelector('.apply') as HTMLButtonElement).disabled).toBe(true);
    await click(el.querySelector('[aria-label="Mes siguiente"]'));
    expect(el.querySelector('.month-title')?.textContent).toBe('Noviembre 2023');
    await click(el.querySelector('[aria-label="3 de noviembre de 2023"]'));
    await click(el.querySelector('[aria-label="7 de noviembre de 2023"]'));
    await click(byText('.apply', 'Aplicar'));
    expect(fixture.componentInstance.range()).toEqual({ from: '2023-11-03', to: '2023-11-07' });
  });

  it('closes without applying on Escape', async () => {
    const { fixture, el, click } = await setup();
    await click(el.querySelector('.control'));
    await click(el.querySelector('[aria-label="3 de octubre de 2023"]'));
    el.querySelector('rs-date-range-picker')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(el.querySelector('.panel')).toBeNull();
    expect(fixture.componentInstance.range()).toEqual({ from: null, to: null });
  });

  it('keeps the panel inside the screen when the field is near the right edge, and closes it on page scroll', async () => {
    const { fixture, el, click } = await setup();
    const host = el.querySelector('rs-date-range-picker') as HTMLElement;
    host.getBoundingClientRect = () => ({ left: window.innerWidth - 100, right: window.innerWidth, top: 100, bottom: 144, width: 100, height: 44, x: 0, y: 0, toJSON: () => ({}) });
    await click(el.querySelector('.control'));
    const panel = el.querySelector('.panel') as HTMLElement;
    expect(panel.style.left).toBe(`${window.innerWidth - 480 - 8}px`);
    document.dispatchEvent(new Event('scroll'));
    await fixture.whenStable();
    expect(el.querySelector('.panel')).toBeNull();
  });
});
