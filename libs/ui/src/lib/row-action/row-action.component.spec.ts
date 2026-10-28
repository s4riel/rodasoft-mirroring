import { TestBed } from '@angular/core/testing';
import { RowActionComponent } from './row-action.component';

describe('RowActionComponent', () => {
  function setup() {
    const fixture = TestBed.createComponent(RowActionComponent);
    fixture.componentRef.setInput('items', [
      { key: 'view', label: 'Ver detalle', icon: 'eye' },
      { key: 'edit', label: 'Editar', icon: 'edit' },
    ]);
    fixture.componentRef.setInput('label', 'Acciones de TR-000123');
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const button = el.querySelector('.button') as HTMLButtonElement;
    const chosen: string[] = [];
    fixture.componentInstance.selected.subscribe((key) => chosen.push(key));
    return { fixture, el, button, chosen };
  }

  afterEach(() => document.body.replaceChildren());

  it('is a named button that opens the menu and reports it expanded', () => {
    const { fixture, el, button } = setup();
    expect(button.getAttribute('aria-label')).toBe('Acciones de TR-000123');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('rs-row-menu')).toBeNull();

    button.click();
    fixture.detectChanges();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelectorAll('[role="menuitem"]')).toHaveLength(2);
  });

  it('emits the key of the chosen item, closes the menu and gives the focus back to the button', () => {
    const { fixture, el, button, chosen } = setup();
    button.click();
    fixture.detectChanges();
    (el.querySelectorAll('[role="menuitem"]')[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(chosen).toEqual(['edit']);
    expect(el.querySelector('rs-row-menu')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('closes with Escape and with a click outside', () => {
    const { fixture, el, button } = setup();
    button.click();
    fixture.detectChanges();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(el.querySelector('rs-row-menu')).toBeNull();

    button.click();
    fixture.detectChanges();
    document.body.click();
    fixture.detectChanges();
    expect(el.querySelector('rs-row-menu')).toBeNull();
  });
});
