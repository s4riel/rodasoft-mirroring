import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FilterBarProductsComponent } from './filter-bar-products.component';

@Component({
  imports: [FilterBarProductsComponent],
  template: `
    <rs-filter-bar-products
      searchPlaceholder="Buscar"
      clearLabel="Limpiar"
      [(search)]="term"
      (cleared)="clears = clears + 1"
    >
      <span rsFilters data-test="slot">filtros</span>
    </rs-filter-bar-products>
  `,
})
class HostComponent {
  term = '';
  clears = 0;
}

describe('FilterBarProductsComponent', () => {
  it('two-way binds the search text, emits clear and projects the filters', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const input = el.querySelector('input') as HTMLInputElement;
    input.value = '6205';
    input.dispatchEvent(new Event('input'));
    expect(fixture.componentInstance.term).toBe('6205');

    (el.querySelector('.clear') as HTMLButtonElement).click();
    expect(fixture.componentInstance.clears).toBe(1);
    expect(el.querySelector('[data-test="slot"]')).not.toBeNull();
  });
});
