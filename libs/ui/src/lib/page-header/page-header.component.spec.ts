import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PageHeaderComponent } from './page-header.component';

@Component({
  imports: [PageHeaderComponent],
  template: `
    <rs-page-header
      type="detail"
      title="Venta 0001"
      description="Detalle de la venta"
      breadcrumbLabel="Migas"
      [breadcrumbs]="crumbs"
    >
      <span rsStatus>Pagada</span>
      <button rsActions>Exportar</button>
      <button rsActions>Nueva venta</button>
    </rs-page-header>
  `,
})
class HostComponent {
  crumbs = [{ label: 'Inicio', link: '/' }, { label: 'Ventas', link: '/sales' }, { label: 'Venta 0001' }];
}

describe('PageHeaderComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  it('renders breadcrumb, title, description, status and actions', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('rs-breadcrumb li').length).toBe(3);
    expect(el.querySelector('h1')?.textContent).toContain('Venta 0001');
    expect(el.querySelector('.description')?.textContent).toContain('Detalle de la venta');
    expect(el.querySelector('.title-row')?.textContent).toContain('Pagada');
    expect(el.querySelectorAll('.actions button').length).toBe(2);
    expect(el.querySelector('rs-page-header')?.getAttribute('data-type')).toBe('detail');
  });

  it('omits breadcrumb and description when not provided', async () => {
    const fixture = TestBed.createComponent(PageHeaderComponent);
    fixture.componentRef.setInput('title', 'Solo título');
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('rs-breadcrumb')).toBeNull();
    expect(el.querySelector('.description')).toBeNull();
  });
});
