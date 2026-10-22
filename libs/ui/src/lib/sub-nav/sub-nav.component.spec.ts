import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SubNavComponent, SubNavItem } from './sub-nav.component';

@Component({
  imports: [SubNavComponent],
  template: `<rs-sub-nav label="Inventario" [items]="items" [(activeKey)]="active" />`,
})
class HostComponent {
  items: SubNavItem[] = [
    { key: 'products', label: 'Productos', badge: 2 },
    { key: 'equivalences', label: 'Equivalencias' },
    { key: 'warehouses', label: 'Almacenes' },
    { key: 'transfers', label: 'Transferencias' },
    { key: 'adjustments', label: 'Ajustes', disabled: true },
    { key: 'kardex', label: 'Kardex' },
  ];
  active = signal<string | undefined>('products');
}

describe('SubNavComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  it('renders every item and flags the active one', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const items = el.querySelectorAll<HTMLElement>('.item');
    expect(items.length).toBe(6);
    expect(items[0].classList).toContain('active');
    expect(items[0].getAttribute('aria-current')).toBe('page');
    expect(items[0].querySelector('.badge')?.textContent).toContain('2');
    expect((items[4] as HTMLButtonElement).disabled).toBe(true);
  });

  it('updates the active key on click', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const items = fixture.nativeElement.querySelectorAll('.item');
    (items[5] as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(fixture.componentInstance.active()).toBe('kardex');
    expect(fixture.nativeElement.querySelectorAll('.item.active').length).toBe(1);
  });
});
