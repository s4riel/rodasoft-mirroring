import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DragHandleComponent } from './drag-handle.component';

@Component({
  imports: [DragHandleComponent],
  template: `<rs-drag-handle [label]="'Arrastrar 6205-2RS'" [disabled]="disabled()" (moveUp)="ups = ups + 1" (moveDown)="downs = downs + 1" />`,
})
class HostComponent {
  readonly disabled = signal(false);
  ups = 0;
  downs = 0;
}

describe('DragHandleComponent', () => {
  async function setup() {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    return { fixture, button, host: fixture.componentInstance };
  }

  const press = (button: HTMLButtonElement, key: string) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    return event;
  };

  it('is a button with its accessible name and six dots', async () => {
    const { button } = await setup();
    expect(button.getAttribute('aria-label')).toBe('Arrastrar 6205-2RS');
    expect(button.querySelectorAll('circle')).toHaveLength(6);
  });

  it('emits moveUp and moveDown with the arrows and keeps the page from scrolling', async () => {
    const { button, host } = await setup();
    expect(press(button, 'ArrowUp').defaultPrevented).toBe(true);
    expect(press(button, 'ArrowDown').defaultPrevented).toBe(true);
    expect(press(button, 'ArrowDown').defaultPrevented).toBe(true);
    expect([host.ups, host.downs]).toEqual([1, 2]);
  });

  it('ignores the other keys', async () => {
    const { button, host } = await setup();
    expect(press(button, 'Enter').defaultPrevented).toBe(false);
    expect(press(button, 'ArrowLeft').defaultPrevented).toBe(false);
    expect([host.ups, host.downs]).toEqual([0, 0]);
  });

  it('does nothing when disabled', async () => {
    const { fixture, button, host } = await setup();
    host.disabled.set(true);
    await fixture.whenStable();
    expect(button.disabled).toBe(true);
    press(button, 'ArrowUp');
    expect([host.ups, host.downs]).toEqual([0, 0]);
  });
});
