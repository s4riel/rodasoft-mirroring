import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { QtyStepperComponent } from './qty-stepper.component';

@Component({
  imports: [QtyStepperComponent, ReactiveFormsModule],
  template: `<rs-qty-stepper [formControl]="control" [min]="1" [max]="3" incrementLabel="Más" decrementLabel="Menos" />`,
})
class HostComponent {
  control = new FormControl(2, { nonNullable: true });
}

describe('QtyStepperComponent', () => {
  it('writes the control value and updates it with the buttons', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const input = el.querySelector('input') as HTMLInputElement;
    const [minus, plus] = Array.from(el.querySelectorAll('button')) as HTMLButtonElement[];
    expect(input.value).toBe('2');
    plus.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.control.value).toBe(3);
    expect(plus.disabled).toBe(true);
    minus.click();
    minus.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.control.value).toBe(1);
    expect(minus.disabled).toBe(true);
  });

  it('clamps typed values and honours the disabled state', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const input = el.querySelector('input') as HTMLInputElement;
    input.value = '99';
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(fixture.componentInstance.control.value).toBe(3);
    fixture.componentInstance.control.disable();
    await fixture.whenStable();
    expect(input.disabled).toBe(true);
  });
});
