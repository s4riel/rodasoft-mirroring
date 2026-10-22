import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabComponent } from './tab.component';
import { TabsComponent } from './tabs.component';

@Component({
  imports: [TabsComponent, TabComponent],
  template: `
    <rs-tabs label="Detalle" [(selected)]="selected">
      <rs-tab value="products" label="Productos">Panel productos</rs-tab>
      <rs-tab value="specs" label="Especificaciones">Panel specs</rs-tab>
      <rs-tab value="compat" label="Compatibilidad" disabled>Panel compat</rs-tab>
    </rs-tabs>
  `,
})
class HostComponent {
  selected = signal<string | undefined>('specs');
}

describe('TabsComponent', () => {
  it('shows the panel of the selected tab and marks aria-selected', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const tabs = el.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs.length).toBe(3);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(tabs[0].getAttribute('aria-selected')).toBe('false');
    expect(el.querySelector('[role="tabpanel"]')?.textContent).toContain('Panel specs');
  });

  it('changes the selection on click and ignores disabled tabs', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const tabs = el.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[0].click();
    await fixture.whenStable();
    expect(fixture.componentInstance.selected()).toBe('products');
    expect(el.querySelector('[role="tabpanel"]')?.textContent).toContain('Panel productos');
    expect(tabs[2].disabled).toBe(true);
  });

  it('moves with the arrow keys', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const tabs = el.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[1].focus();
    tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await fixture.whenStable();
    expect(fixture.componentInstance.selected()).toBe('products');
  });
});
