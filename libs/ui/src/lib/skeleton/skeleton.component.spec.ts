import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SkeletonComponent } from './skeleton.component';

@Component({
  imports: [SkeletonComponent],
  template: `<rs-skeleton shape="circle" width="40px" height="40px" />`,
})
class HostComponent {}

describe('SkeletonComponent', () => {
  it('aplica forma y tamaño y se oculta a lectores de pantalla', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement.querySelector('rs-skeleton');
    expect(el.getAttribute('data-shape')).toBe('circle');
    expect(el.style.width).toBe('40px');
    expect(el.style.height).toBe('40px');
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });
});
