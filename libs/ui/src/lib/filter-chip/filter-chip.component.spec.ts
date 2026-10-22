import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChipMediaComponent } from './chip-media.component';
import { FieldMediaComponent } from './field-media.component';
import { FilterChipComponent } from './filter-chip.component';

@Component({
  imports: [FilterChipComponent, ChipMediaComponent, FieldMediaComponent],
  template: `
    <rs-filter-chip size="l" [(selected)]="selected" label="Alemania">
      <rs-chip-media type="flag" country="DE" />
    </rs-filter-chip>
    <rs-filter-chip [disabled]="true" label="SKF" />
    <rs-chip-media type="count" text="12" />
    <rs-field-media type="brand" text="SKF" />
  `,
})
class HostComponent {
  readonly selected = signal(false);
}

describe('FilterChipComponent', () => {
  it('alterna la selección y muestra el cierre solo cuando está activo', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    const chip = root.querySelector('rs-filter-chip') as HTMLElement;
    const button = chip.querySelector('button') as HTMLButtonElement;

    expect(chip.getAttribute('data-size')).toBe('l');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(chip.querySelector('rs-icon')).toBeNull();
    expect(chip.querySelector('rs-chip-media')).not.toBeNull();

    button.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.selected()).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(chip.querySelector('rs-icon')).not.toBeNull();
  });

  it('no cambia cuando está deshabilitado', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const disabled = fixture.nativeElement.querySelectorAll('rs-filter-chip')[1].querySelector('button') as HTMLButtonElement;
    expect(disabled.disabled).toBe(true);
  });

  it('renderiza los medios de chip y de campo', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('rs-chip-media[data-type="count"]')?.textContent).toContain('12');
    expect(root.querySelector('rs-field-media[data-type="brand"]')?.textContent).toContain('SKF');
    expect(root.querySelector('rs-flag[data-country="DE"]')).not.toBeNull();
  });
});
