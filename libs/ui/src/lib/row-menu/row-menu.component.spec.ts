import { TestBed } from '@angular/core/testing';
import { RowMenuComponent } from './row-menu.component';

describe('RowMenuComponent', () => {
  it('renders one item per entry, a divider before separated ones, and emits the key', () => {
    const fixture = TestBed.createComponent(RowMenuComponent);
    fixture.componentRef.setInput('items', [
      { key: 'view', label: 'Ver', icon: 'eye' },
      { key: 'delete', label: 'Borrar', icon: 'trash', danger: true, separated: true },
    ]);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('[role="menuitem"]')).toHaveLength(2);
    expect(el.querySelectorAll('[role="separator"]')).toHaveLength(1);

    const emitted: string[] = [];
    fixture.componentInstance.selected.subscribe((k) => emitted.push(k));
    (el.querySelectorAll('[role="menuitem"]')[1] as HTMLButtonElement).click();
    expect(emitted).toEqual(['delete']);
  });
});
