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

  it('focuses the first item on open and moves with the arrow keys, Home and End', async () => {
    const fixture = TestBed.createComponent(RowMenuComponent);
    fixture.componentRef.setInput('items', [
      { key: 'view', label: 'Ver', icon: 'eye' },
      { key: 'edit', label: 'Editar', icon: 'edit' },
      { key: 'delete', label: 'Borrar', icon: 'trash', separated: true },
    ]);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();

    const el: HTMLElement = fixture.nativeElement;
    const items = Array.from(el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    const press = (key: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

    expect(document.activeElement).toBe(items[0]);
    press('ArrowDown');
    expect(document.activeElement).toBe(items[1]);
    press('End');
    expect(document.activeElement).toBe(items[2]);
    press('ArrowDown');
    expect(document.activeElement).toBe(items[0]);
    press('ArrowUp');
    expect(document.activeElement).toBe(items[2]);
    press('Home');
    expect(document.activeElement).toBe(items[0]);

    el.remove();
  });
});
