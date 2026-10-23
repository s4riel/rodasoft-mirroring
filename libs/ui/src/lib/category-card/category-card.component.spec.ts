import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { CategoryCardComponent } from './category-card.component';

@Component({
  imports: [CategoryCardComponent],
  template: `
    <rs-category-card
      title="Rodamientos"
      description="12 subcategorías"
      [selected]="selected()"
      [disabled]="disabled()"
      (selectedChange)="selected.set($event)"
    >
      <span slot="glyph" class="glyph"></span>
    </rs-category-card>
  `,
})
class HostComponent {
  readonly selected = signal(false);
  readonly disabled = signal(false);
}

describe('CategoryCardComponent', () => {
  function setup() {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const card = fixture.debugElement.query(By.directive(CategoryCardComponent));
    return { fixture, host: fixture.componentInstance, el: card.nativeElement as HTMLElement };
  }

  it('shows the title, the description and the projected glyph', () => {
    const { el } = setup();
    expect(el.querySelector('.title')?.textContent?.trim()).toBe('Rodamientos');
    expect(el.querySelector('.description')?.textContent?.trim()).toBe('12 subcategorías');
    expect(el.querySelector('.glyph')).not.toBeNull();
  });

  it('is a radio that selects on click, Space and Enter', () => {
    const { fixture, host, el } = setup();
    expect(el.getAttribute('role')).toBe('radio');
    expect(el.getAttribute('aria-checked')).toBe('false');

    el.click();
    fixture.detectChanges();
    expect(host.selected()).toBe(true);
    expect(el.getAttribute('aria-checked')).toBe('true');
    expect(el.getAttribute('data-selected')).toBe('true');

    host.selected.set(false);
    fixture.detectChanges();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    fixture.detectChanges();
    expect(host.selected()).toBe(true);
  });

  it('does not select when disabled', () => {
    const { fixture, host, el } = setup();
    host.disabled.set(true);
    fixture.detectChanges();
    expect(el.getAttribute('aria-disabled')).toBe('true');
    expect(el.getAttribute('tabindex')).toBe('-1');

    el.click();
    fixture.detectChanges();
    expect(host.selected()).toBe(false);
  });
});
