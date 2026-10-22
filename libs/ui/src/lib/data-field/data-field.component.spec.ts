import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DataFieldComponent } from './data-field.component';

@Component({
  imports: [DataFieldComponent],
  template: `
    <rs-data-field label="Código" icon="barcode" type="mono">6205-2RS</rs-data-field>
    <rs-data-field label="Sello" icon="tag">2RS</rs-data-field>
    <rs-data-field label="Proveedor" type="empty">ignored</rs-data-field>
    <rs-data-field label="Marca" layout="inline" [showIcon]="false">SKF</rs-data-field>
  `,
})
class HostComponent {}

describe('DataFieldComponent', () => {
  async function render() {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    return Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('rs-data-field'));
  }

  it('shows the label and the value, with the icon hidden from assistive tech', async () => {
    const [code] = await render();
    expect(code.querySelector('.label')?.textContent).toBe('Código');
    expect(code.querySelector('.value')?.textContent).toContain('6205-2RS');
    const icon = code.querySelector('.label-row rs-icon');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });

  it('mirrors Type and Layout (text and stacked by default)', async () => {
    const [code, seal, , brand] = await render();
    expect(code.getAttribute('data-type')).toBe('mono');
    expect(seal.getAttribute('data-type')).toBe('text');
    expect(seal.getAttribute('data-layout')).toBe('stacked');
    expect(brand.getAttribute('data-layout')).toBe('inline');
  });

  it('shows a dash instead of the value when Type is empty', async () => {
    const [, , empty] = await render();
    expect(empty.querySelector('.value')?.textContent?.trim()).toBe('—');
    expect(empty.textContent).not.toContain('ignored');
  });

  it('hides the icon with ShowIcon off', async () => {
    const [, , , brand] = await render();
    expect(brand.querySelector('rs-icon')).toBeNull();
  });
});
