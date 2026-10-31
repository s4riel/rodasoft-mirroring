import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ImageViewerComponent } from './image-viewer.component';

@Component({
  imports: [ImageViewerComponent],
  template: `
    <button id="opener" (click)="open.set(true)">Abrir</button>
    <rs-image-viewer
      [(open)]="open"
      [(index)]="index"
      [images]="images()"
      label="Fotos"
      closeLabel="Cerrar"
      previousLabel="Anterior"
      nextLabel="Siguiente"
    />
  `,
})
class HostComponent {
  readonly open = signal(false);
  readonly index = signal(0);
  readonly images = signal(['a.jpg', 'b.jpg', 'c.jpg']);
}

describe('ImageViewerComponent', () => {
  async function openViewer(index = 0) {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    fixture.componentInstance.index.set(index);
    fixture.componentInstance.open.set(true);
    await fixture.whenStable();
    return fixture;
  }
  const dialog = (f: { nativeElement: HTMLElement }) => f.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
  const bigImage = (f: { nativeElement: HTMLElement }) => f.nativeElement.querySelector('.image') as HTMLImageElement;
  const press = (el: HTMLElement, key: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

  it('renders nothing closed and opens as a modal dialog on the chosen image', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    expect(dialog(fixture)).toBeNull();

    fixture.componentInstance.index.set(1);
    fixture.componentInstance.open.set(true);
    await fixture.whenStable();
    expect(dialog(fixture).getAttribute('aria-modal')).toBe('true');
    expect(bigImage(fixture).getAttribute('src')).toBe('b.jpg');
    expect(fixture.nativeElement.querySelector('.counter').textContent).toContain('2 / 3');
  });

  it('moves with the arrows and the keyboard, wrapping at both ends', async () => {
    const fixture = await openViewer(2);
    const host = fixture.componentInstance;
    press(dialog(fixture), 'ArrowRight');
    expect(host.index()).toBe(0);
    press(dialog(fixture), 'ArrowLeft');
    expect(host.index()).toBe(2);
    (fixture.nativeElement.querySelector('[aria-label="Anterior"]') as HTMLElement).click();
    expect(host.index()).toBe(1);
  });

  it('jumps to a thumbnail', async () => {
    const fixture = await openViewer();
    const thumbs = fixture.nativeElement.querySelectorAll('.thumb') as NodeListOf<HTMLElement>;
    thumbs[2].click();
    await fixture.whenStable();
    expect(fixture.componentInstance.index()).toBe(2);
    expect(thumbs[2].getAttribute('aria-current')).toBe('true');
  });

  it('closes with ESC, the close button and the backdrop, restoring focus and scroll', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const opener = fixture.nativeElement.querySelector('#opener') as HTMLElement;
    opener.focus();
    fixture.componentInstance.open.set(true);
    await fixture.whenStable();
    expect(document.body.style.overflow).toBe('hidden');

    press(dialog(fixture), 'Escape');
    await fixture.whenStable();
    expect(dialog(fixture)).toBeNull();
    expect(document.body.style.overflow).not.toBe('hidden');
    expect(document.activeElement).toBe(opener);

    fixture.componentInstance.open.set(true);
    await fixture.whenStable();
    (fixture.nativeElement.querySelector('.close') as HTMLElement).click();
    await fixture.whenStable();
    expect(fixture.componentInstance.open()).toBe(false);

    fixture.componentInstance.open.set(true);
    await fixture.whenStable();
    const backdrop = fixture.nativeElement.querySelector('.backdrop') as HTMLElement;
    backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await fixture.whenStable();
    expect(fixture.componentInstance.open()).toBe(false);
  });

  it('hides navigation and thumbnails with a single image', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.images.set(['a.jpg']);
    await fixture.whenStable();
    fixture.componentInstance.open.set(true);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.nav')).toBeNull();
    expect(fixture.nativeElement.querySelector('.thumbs')).toBeNull();
  });
});
