import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  model,
  viewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { IconComponent } from '../icon/icon.component';

const FOCUSABLE = 'button:not([disabled])';

/**
 * Full-screen gallery viewer (lightbox) for a list of image URLs. `[(open)]` and `[(index)]` two-way.
 * Behaviour: focus moves to the close button on open and is restored on close, Tab is trapped, ESC and a click on
 * the backdrop close, ArrowLeft/ArrowRight (and the arrow buttons) move between images, body scroll is locked.
 * Not in Figma yet: flagged as "estimated" in `docs/ui-library.md`.
 */
@Component({
  selector: 'rs-image-viewer',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './image-viewer.component.html',
  styleUrl: './image-viewer.component.scss',
})
export class ImageViewerComponent {
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private previouslyFocused: HTMLElement | null = null;
  private previousOverflow: string | null = null;
  private wasOpen = false;

  readonly open = model(false);
  /** Index of the image on display. */
  readonly index = model(0);
  readonly images = input<readonly string[]>([]);
  /** Accessible name of the dialog; each image reads "{label} {n} de {total}". */
  readonly label = input<string>('Galería de imágenes');
  readonly closeLabel = input<string>('Close');
  readonly previousLabel = input<string>('Previous');
  readonly nextLabel = input<string>('Next');

  protected readonly current = computed(() => this.images()[this.index()] ?? null);
  protected readonly hasMany = computed(() => this.images().length > 1);
  protected readonly counter = computed(() => `${this.index() + 1} / ${this.images().length}`);

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

  protected previous(): void {
    this.go(-1);
  }

  protected next(): void {
    this.go(1);
  }

  protected select(index: number): void {
    this.index.set(index);
  }

  protected onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'Escape':
        event.stopPropagation();
        event.preventDefault();
        this.close();
        return;
      case 'ArrowLeft':
        event.preventDefault();
        this.previous();
        return;
      case 'ArrowRight':
        event.preventDefault();
        this.next();
        return;
      case 'Tab':
        this.trapTab(event);
        return;
    }
  }

  /** Wraps around: the last image is followed by the first. */
  private go(step: number): void {
    const total = this.images().length;
    if (total > 1) {
      this.index.set((this.index() + step + total) % total);
    }
  }

  private trapTab(event: KeyboardEvent): void {
    const panel = this.panel()?.nativeElement;
    if (!panel) {
      return;
    }
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      event.preventDefault();
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
        if (this.open()) {
          this.panel()?.nativeElement.querySelector<HTMLElement>('.close')?.focus();
        }
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
