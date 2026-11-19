import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LinkComponent } from './link.component';

@Component({
  imports: [LinkComponent],
  template: `<a rsLink href="/invoicing/settings" aria-label="Abrir firma digital">Abrir</a>`,
})
class HostComponent {}

describe('LinkComponent', () => {
  it('keeps the native anchor, its label and its href, and adds the shared class', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('a');
    expect(link.classList.contains('rs-link')).toBe(true);
    expect(link.textContent?.trim()).toBe('Abrir');
    expect(link.getAttribute('href')).toBe('/invoicing/settings');
    expect(link.getAttribute('aria-label')).toBe('Abrir firma digital');
  });
});
