import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BreadcrumbComponent, BreadcrumbItem } from './breadcrumb.component';

@Component({
  imports: [BreadcrumbComponent],
  template: `<rs-breadcrumb [items]="items()" label="Migas" />`,
})
class HostComponent {
  items = signal<BreadcrumbItem[]>([
    { label: 'Inicio', link: '/' },
    { label: 'Productos', link: '/products' },
    { label: 'Rodamientos' },
  ]);
}

describe('BreadcrumbComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  it('renders links, separators and marks the last level as current', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('li').length).toBe(3);
    expect(el.querySelectorAll('a.item').length).toBe(2);
    expect(el.querySelectorAll('.sep').length).toBe(2);
    const current = el.querySelector('.item.current');
    expect(current?.textContent).toContain('Rodamientos');
    expect(current?.getAttribute('aria-current')).toBe('page');
    expect(el.querySelector('nav')?.getAttribute('aria-label')).toBe('Migas');
  });

  it('supports four levels and disabled items', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.items.set([
      { label: 'A', link: '/a' },
      { label: 'B', link: '/b', disabled: true },
      { label: 'C', link: '/c' },
      { label: 'D' },
    ]);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('li').length).toBe(4);
    expect(el.querySelector('.item.disabled')?.getAttribute('aria-disabled')).toBe('true');
  });
});
