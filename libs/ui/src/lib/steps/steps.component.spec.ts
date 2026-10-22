import { TestBed } from '@angular/core/testing';
import { StepsComponent } from './steps.component';

describe('StepsComponent', () => {
  it('marks done, current and upcoming steps', async () => {
    const fixture = TestBed.createComponent(StepsComponent);
    fixture.componentRef.setInput('steps', ['Carrito', 'Envío', 'Pago']);
    fixture.componentRef.setInput('current', 2);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const steps = el.querySelectorAll('li.step');
    expect(steps.length).toBe(3);
    expect(steps[0].classList).toContain('done');
    expect(steps[1].classList).toContain('current');
    expect(steps[1].getAttribute('aria-current')).toBe('step');
    expect(steps[2].classList).not.toContain('done');
    expect(steps[2].querySelector('.circle')?.textContent?.trim()).toBe('3');
    expect(el.querySelectorAll('li.connector').length).toBe(2);
    expect(el.querySelectorAll('li.connector.done').length).toBe(1);
  });
});
