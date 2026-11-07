import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { StatusTimelineComponent, type StatusTimelineStep } from './status-timeline.component';

@Component({
  imports: [StatusTimelineComponent],
  template: `<rs-status-timeline [steps]="steps" label="Estados" />`,
})
class Host {
  steps: StatusTimelineStep[] = [
    { label: 'Borrador', caption: '14/10', state: 'done' },
    { label: 'Enviada', caption: '14/10', state: 'done' },
    { label: 'Vencida', caption: '21/10', state: 'warning' },
    { label: 'Convertida', caption: '—', state: 'pending' },
  ];
}

describe('StatusTimelineComponent', () => {
  it('draws every step with its label, caption and state, and a line between steps', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const steps = Array.from(el.querySelectorAll('li.step'));
    expect(steps.map((s) => s.querySelector('.label')?.textContent?.trim())).toEqual(['Borrador', 'Enviada', 'Vencida', 'Convertida']);
    expect(steps.map((s) => s.querySelector('.caption')?.textContent?.trim())).toEqual(['14/10', '14/10', '21/10', '—']);
    expect(steps.map((s) => ['done', 'current', 'warning', 'pending'].find((c) => s.classList.contains(c)))).toEqual(['done', 'done', 'warning', 'pending']);
    expect(el.querySelectorAll('li.line')).toHaveLength(3);
    expect(el.querySelector('ol')?.getAttribute('aria-label')).toBe('Estados');
  });

  it('marks the current step for assistive technology', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.steps = [{ label: 'Esperando respuesta', state: 'current' }];
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('li.step')?.getAttribute('aria-current')).toBe('step');
  });
});
