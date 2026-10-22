import { ApplicationRef, ComponentRef, createComponent, Directive, ElementRef, EnvironmentInjector, inject, input, OnDestroy } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { TooltipComponent, TooltipPosition } from './tooltip.component';

let nextId = 0;
const GAP = 8; // distance between host and bubble (space-2)
const VIEWPORT_MARGIN = 8;

/**
 * Tooltip on hover and keyboard focus: `<button rsTooltip="Texto" rsTooltipPosition="bottom">`.
 * The bubble is attached to <body> (position: fixed), linked with aria-describedby and closed with ESC.
 */
@Directive({
  selector: '[rsTooltip]',
  host: {
    '(mouseenter)': 'show()',
    '(mouseleave)': 'hide()',
    '(focusin)': 'show()',
    '(focusout)': 'hide()',
    '(keydown.escape)': 'hide()',
  },
})
export class TooltipDirective implements OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly appRef = inject(ApplicationRef);
  private readonly injector = inject(EnvironmentInjector);
  private readonly document = inject(DOCUMENT);
  private readonly id = `rs-tooltip-${nextId++}`;
  private ref: ComponentRef<TooltipComponent> | null = null;

  readonly text = input<string | null | undefined>('', { alias: 'rsTooltip' });
  readonly position = input<TooltipPosition>('top', { alias: 'rsTooltipPosition' });

  show(): void {
    const text = this.text();
    if (!text || this.ref) {
      return;
    }
    const ref = createComponent(TooltipComponent, { environmentInjector: this.injector });
    ref.setInput('text', text);
    ref.setInput('position', this.position());
    this.appRef.attachView(ref.hostView);
    const el = ref.location.nativeElement as HTMLElement;
    el.id = this.id;
    el.style.position = 'fixed';
    el.style.zIndex = '1200';
    el.style.top = '0';
    el.style.left = '0';
    this.document.body.appendChild(el);
    ref.changeDetectorRef.detectChanges();
    this.place(el);
    this.host.nativeElement.setAttribute('aria-describedby', this.id);
    this.ref = ref;
  }

  hide(): void {
    if (!this.ref) {
      return;
    }
    const el = this.ref.location.nativeElement as HTMLElement;
    this.ref.destroy();
    el.remove(); // the host element was appended to <body> by hand
    this.ref = null;
    this.host.nativeElement.removeAttribute('aria-describedby');
  }

  ngOnDestroy(): void {
    this.hide();
  }

  private place(tip: HTMLElement): void {
    const anchor = this.host.nativeElement.getBoundingClientRect();
    const box = tip.getBoundingClientRect();
    const view = this.document.defaultView;
    const vw = view?.innerWidth ?? 0;
    const vh = view?.innerHeight ?? 0;
    let top: number;
    let left: number;
    switch (this.position()) {
      case 'bottom':
        top = anchor.bottom + GAP;
        left = anchor.left + (anchor.width - box.width) / 2;
        break;
      case 'left':
        top = anchor.top + (anchor.height - box.height) / 2;
        left = anchor.left - box.width - GAP;
        break;
      case 'right':
        top = anchor.top + (anchor.height - box.height) / 2;
        left = anchor.right + GAP;
        break;
      default:
        top = anchor.top - box.height - GAP;
        left = anchor.left + (anchor.width - box.width) / 2;
    }
    if (vw > 0 && vh > 0) {
      left = Math.min(Math.max(left, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, vw - box.width - VIEWPORT_MARGIN));
      top = Math.min(Math.max(top, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, vh - box.height - VIEWPORT_MARGIN));
    }
    tip.style.top = `${Math.round(top)}px`;
    tip.style.left = `${Math.round(left)}px`;
  }
}
