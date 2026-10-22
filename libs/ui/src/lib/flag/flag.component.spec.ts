import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FLAG_COUNTRIES, FlagComponent } from './flag.component';

@Component({
  imports: [FlagComponent],
  template: `
    @for (c of countries; track c) {
      <rs-flag [country]="c" />
    }
    <rs-flag country="BO" label="Bolivia" />
  `,
})
class HostComponent {
  readonly countries = FLAG_COUNTRIES;
}

describe('FlagComponent', () => {
  it('dibuja las 14 banderas con su SVG', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const flags: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('rs-flag'));
    expect(flags.length).toBe(15);
    for (const f of flags) {
      expect(f.querySelector('svg')?.innerHTML.length).toBeGreaterThan(20);
    }
  });

  it('es decorativa salvo que tenga etiqueta', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const flags: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('rs-flag'));
    expect(flags[0].getAttribute('aria-hidden')).toBe('true');
    const labelled = flags[flags.length - 1];
    expect(labelled.getAttribute('aria-label')).toBe('Bolivia');
    expect(labelled.getAttribute('aria-hidden')).toBeNull();
  });
});
