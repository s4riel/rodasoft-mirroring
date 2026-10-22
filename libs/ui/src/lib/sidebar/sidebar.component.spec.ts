import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NavGroup, SidebarComponent } from './sidebar.component';

const GROUPS: NavGroup[] = [
  {
    label: 'Operación diaria',
    items: [
      { label: 'Inicio', icon: 'home', route: '/', current: true },
      { label: 'Inventario', icon: 'inventory', route: '/inventory', badge: 3 },
    ],
  },
  {
    label: 'Canales y control',
    items: [{ label: 'Configuración', icon: 'settings', route: '/settings', disabled: true }],
  },
];

@Component({
  imports: [SidebarComponent],
  template: `
    <rs-sidebar [groups]="groups" brandName="Rodalaser" navLabel="Módulos">
      <p rsSidebarFooter>v1.0</p>
    </rs-sidebar>
  `,
})
class HostComponent {
  groups = GROUPS;
}

describe('SidebarComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  it('renders groups, items, the current indicator and the projected footer', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('.group').length).toBe(2);
    expect(el.querySelectorAll('.item').length).toBe(3);
    const current = el.querySelector('a.item.current') as HTMLElement;
    expect(current.textContent).toContain('Inicio');
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(current.querySelector('.indicator')).not.toBeNull();
    expect(el.querySelector('.badge')?.textContent).toContain('3');
    expect(el.querySelector('nav')?.getAttribute('aria-label')).toBe('Módulos');
    expect(el.querySelector('.footer')?.textContent).toContain('v1.0');
    expect(el.querySelector('.wordmark')?.textContent).toContain('Rodalaser');
  });

  it('renders disabled items as non-interactive', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const disabled = fixture.nativeElement.querySelector('.item.disabled') as HTMLElement;
    expect(disabled.tagName).toBe('SPAN');
    expect(disabled.getAttribute('aria-disabled')).toBe('true');
  });
});
