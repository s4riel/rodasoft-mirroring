import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { QrCodeComponent } from './qr-code.component';

@Component({
  imports: [QrCodeComponent],
  template: `<rs-qr-code [payload]="payload()" label="Código QR de pago" />`,
})
class HostComponent {
  readonly payload = signal('RODASOFT-MOCK|ref-1|490.00');
}

describe('QrCodeComponent', () => {
  async function render() {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const host = fixture.nativeElement.querySelector('rs-qr-code') as HTMLElement;
    return { fixture, host, path: () => host.querySelector('path')?.getAttribute('d') ?? '' };
  }

  it('draws the code as one path of dark squares inside a square viewBox', async () => {
    const { host, path } = await render();
    expect(path()).toMatch(/^M\d+ \d+h1v1h-1z/);
    const box = host.querySelector('svg')?.getAttribute('viewBox') ?? '';
    const [, , width, height] = box.split(' ').map(Number);
    expect(width).toBeGreaterThan(8);
    expect(width).toBe(height);
  });

  it('leaves the quiet zone around the code', async () => {
    const { path } = await render();
    const squares = [...path().matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(Math.min(...squares.map(([x]) => x))).toBeGreaterThanOrEqual(4);
    expect(Math.min(...squares.map(([, y]) => y))).toBeGreaterThanOrEqual(4);
  });

  it('draws the same code for the same payload and another one for another payload', async () => {
    const { fixture, host, path } = await render();
    const first = path();
    expect(host.querySelector('path')?.getAttribute('d')).toBe(first);
    fixture.componentInstance.payload.set('RODASOFT-MOCK|ref-2|100.00');
    await fixture.whenStable();
    expect(path()).not.toBe(first);
  });

  it('is a labelled image for assistive technology', async () => {
    const { host } = await render();
    expect(host.getAttribute('role')).toBe('img');
    expect(host.getAttribute('aria-label')).toBe('Código QR de pago');
    expect(host.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});
