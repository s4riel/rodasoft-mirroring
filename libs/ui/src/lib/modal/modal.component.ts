import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { IconComponent } from '../icon/icon.component';

export type ModalVariant = 'confirmation' | 'form';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

let nextId = 0;

/**
 * Modal dialog (Figma: Modal Variant=Confirmation|Form). `[(open)]` two-way.
 * Behaviour: focus moves in on open and is restored on close, Tab is trapped, ESC and backdrop click close
 * (backdrop can be disabled), body scroll is locked while open.
 * Slots: default = body, `[slot=footer]` = actions (right aligned). Title via `heading`.
 */
@Component({
  selector: 'rs-modal',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="backdrop" (mousedown)="onBackdrop($event)">
        <div
          #panel
          class="panel"
          role="dialog"
          aria-modal="true"
          tabindex="-1"
          [attr.data-variant]="variant()"
          [attr.aria-labelledby]="heading() ? titleId : null"
          [attr.aria-label]="heading() ? null : label() || null"
          (keydown)="onKeydown($event)"
        >
          <header class="header">
            @if (heading()) {
              <h2 class="title" [id]="titleId">{{ heading() }}</h2>
            }
            <button type="button" class="close" [attr.aria-label]="closeLabel()" (click)="close()">
              <rs-icon name="close" [size]="20" />
            </button>
          </header>
          <div class="body"><ng-content /></div>
          <footer class="footer"><ng-content select="[slot=footer]" /></footer>
        </div>
      </div>
    }
  `,
  styles: `
    :host { display: contents; }
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: grid;
      place-items: center;
      padding: var(--space-4);
      background: color-mix(in srgb, var(--black) 48%, transparent);
    }
    .panel {
      display: flex;
      flex-direction: column;
      width: 100%;
      max-width: 480px;
      max-height: calc(100dvh - 2 * var(--space-4));
      border-radius: var(--radius-2xl);
      background: var(--bg-surface);
      color: var(--text-primary);
      box-shadow: var(--shadow-modal);
      outline: none;
    }
    .panel[data-variant='form'] { max-width: 640px; }
    .header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--space-4);
      padding: var(--space-6) var(--space-6) 0;
    }
    .title {
      flex: 1;
      font-size: var(--display-h3-size);
      line-height: var(--display-h3-line-height);
      font-weight: var(--display-h3-weight);
    }
    .close {
      flex: none;
      display: inline-grid;
      place-items: center;
      width: 36px;
      height: 36px;
      margin: -6px -6px 0 auto;
      border: 0;
      border-radius: var(--radius-full);
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
    }
    .close:hover { background: var(--bg-surface-2); color: var(--text-primary); }
    .close:focus-visible { outline: var(--stroke-focus) solid var(--focus-control); outline-offset: var(--focus-offset); }
    .body {
      padding: var(--space-3) var(--space-6) var(--space-6);
      overflow: auto;
      color: var(--text-muted);
      font-size: var(--body-md-size);
      line-height: var(--body-md-line-height);
    }
    .panel[data-variant='form'] .body { color: var(--text-primary); }
    .footer {
      display: flex;
      justify-content: flex-end;
      gap: var(--space-3);
      padding: 0 var(--space-6) var(--space-6);
    }
    .footer:empty { display: none; }
    .panel[data-variant='form'] .footer {
      padding-top: var(--space-4);
      border-top: var(--stroke-default) solid var(--border-default);
    }
    @media (prefers-reduced-motion: no-preference) {
      .panel { animation: rs-modal-in var(--motion-base) var(--ease-out); }
      @keyframes rs-modal-in { from { opacity: 0; transform: translateY(8px) scale(0.98); } }
    }
  `,
})
export class ModalComponent {
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private previouslyFocused: HTMLElement | null = null;
  private previousOverflow: string | null = null;
  private wasOpen = false;

  protected readonly titleId = `rs-modal-title-${nextId++}`;

  readonly open = model(false);
  readonly variant = input<ModalVariant>('confirmation');
  readonly heading = input<string>('');
  /** Accessible name when there is no `heading`. */
  readonly label = input<string>('');
  readonly closeLabel = input<string>('Close');
  readonly closeOnBackdrop = input(true);
  /** Emits after the modal closes (ESC, backdrop, close button or `open` set to false). */
  readonly closed = output<void>();

  constructor() {
    effect(() => {
      if (this.open()) {
        this.onOpened();
      } else {
        this.onClosed();
      }
    });
    inject(DestroyRef).onDestroy(() => this.unlockScroll());
  }

  close(): void {
    if (this.open()) {
      this.open.set(false);
    }
  }

  protected onBackdrop(event: MouseEvent): void {
    if (this.closeOnBackdrop() && event.target === event.currentTarget) {
      this.close();
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const panel = this.panel()?.nativeElement;
    if (!panel) {
      return;
    }
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = this.document.activeElement;
    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private onOpened(): void {
    this.wasOpen = true;
    const active = this.document.activeElement;
    this.previouslyFocused = active instanceof HTMLElement ? active : null;
    this.lockScroll();
    afterNextRender(
      () => {
        const panel = this.panel()?.nativeElement;
        if (!panel || !this.open()) {
          return;
        }
        // Prefer the first field/action in the body; fall back to the panel itself.
        const target = panel.querySelector('.body')?.querySelector<HTMLElement>(FOCUSABLE) ?? panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel;
        target.focus();
      },
      { injector: this.injector },
    );
  }

  private onClosed(): void {
    if (!this.wasOpen) {
      return;
    }
    this.wasOpen = false;
    const target = this.previouslyFocused;
    this.previouslyFocused = null;
    this.unlockScroll();
    target?.focus();
    this.closed.emit();
  }

  private lockScroll(): void {
    const body = this.document.body;
    if (this.previousOverflow === null) {
      this.previousOverflow = body.style.overflow;
      body.style.overflow = 'hidden';
    }
  }

  private unlockScroll(): void {
    if (this.previousOverflow !== null) {
      this.document.body.style.overflow = this.previousOverflow;
      this.previousOverflow = null;
    }
  }
}
