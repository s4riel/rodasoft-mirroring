import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { PriceRangeComponent, PriceRangeValue } from './price-range.component';

@Component({
  imports: [PriceRangeComponent, ReactiveFormsModule],
  template: `<rs-price-range [formControl]="control" [min]="0" [max]="500" label="Precio" lowLabel="Mínimo" highLabel="Máximo" prefix="Bs" />`,
})
class HostComponent {
  control = new FormControl<PriceRangeValue>([50, 300], { nonNullable: true });
}

describe('PriceRangeComponent', () => {
  it('shows the two values from the form control', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const nums = fixture.nativeElement.querySelectorAll('input.num') as NodeListOf<HTMLInputElement>;
    expect(nums[0].value).toBe('50');
    expect(nums[1].value).toBe('300');
    expect(fixture.nativeElement.querySelector('.label')?.textContent).toContain('Precio');
    expect(fixture.nativeElement.querySelectorAll('input[type="range"]').length).toBe(2);
  });

  it('updates the control and keeps from <= to', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const nums = fixture.nativeElement.querySelectorAll('input.num') as NodeListOf<HTMLInputElement>;
    nums[0].value = '120';
    nums[0].dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(fixture.componentInstance.control.value).toEqual([120, 300]);
    nums[0].value = '450';
    nums[0].dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(fixture.componentInstance.control.value).toEqual([300, 300]);
    nums[1].value = '9999';
    nums[1].dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(fixture.componentInstance.control.value).toEqual([300, 500]);
  });

  it('disables every input', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.control.disable();
    await fixture.whenStable();
    const inputs = fixture.nativeElement.querySelectorAll('input') as NodeListOf<HTMLInputElement>;
    expect(inputs.length).toBe(4);
    inputs.forEach((i) => expect(i.disabled).toBe(true));
  });
});
