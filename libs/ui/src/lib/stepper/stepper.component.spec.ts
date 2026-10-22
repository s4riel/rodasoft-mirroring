import { TestBed } from '@angular/core/testing';
import { StepperComponent, StepperStep } from './stepper.component';

const STEPS: StepperStep[] = [
  { label: 'Identificación', tag: 'Requerido' },
  { label: 'Dimensiones', tag: 'Requerido' },
  { label: 'Especificaciones', tag: 'Opcional' },
  { label: 'Precio e inventario', tag: 'Requerido' },
];

describe('StepperComponent', () => {
  it('renders done/current/upcoming items and connectors for 4 steps', async () => {
    const fixture = TestBed.createComponent(StepperComponent);
    fixture.componentRef.setInput('steps', STEPS);
    fixture.componentRef.setInput('current', 3);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('li.item').length).toBe(4);
    expect(el.querySelectorAll('li.item.done').length).toBe(2);
    expect(el.querySelectorAll('li.item.current').length).toBe(1);
    expect(el.querySelectorAll('li.item.upcoming').length).toBe(1);
    expect(el.querySelectorAll('li.connector').length).toBe(3);
    expect(el.querySelectorAll('li.connector.done').length).toBe(2);
    expect(el.querySelector('li.current')?.getAttribute('aria-current')).toBe('step');
    expect(el.querySelectorAll('.tag')[2].textContent).toContain('Opcional');
  });

  it('supports six steps', async () => {
    const fixture = TestBed.createComponent(StepperComponent);
    fixture.componentRef.setInput(
      'steps',
      Array.from({ length: 6 }, (_, i) => ({ label: `Paso ${i + 1}` })),
    );
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('li.item').length).toBe(6);
    expect(fixture.nativeElement.querySelectorAll('.tag').length).toBe(0);
  });
});
