import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { ToastComponent } from './toast.component';
import { ToastService } from './toast.service';

export type ToastOutletPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

/** Fixed container that renders the `ToastService` queue. Place one in the root template. */
@Component({
  selector: 'rs-toast-outlet',
  imports: [ToastComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-position]': 'position()', 'aria-live': 'polite' },
  template: `
    @for (toast of service.toasts(); track toast.id) {
      <rs-toast [type]="toast.type" [heading]="toast.heading ?? ''" [closeLabel]="closeLabel()" (dismissed)="service.dismiss(toast.id)">{{
        toast.message
      }}</rs-toast>
    }
  `,
  styles: `
    :host {
      position: fixed;
      z-index: 1100;
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      width: calc(100% - 2 * var(--space-4));
      max-width: 400px;
      pointer-events: none;
    }
    :host > * { pointer-events: auto; }
    :host([data-position='bottom-right']) { right: var(--space-4); bottom: var(--space-4); }
    :host([data-position='bottom-left']) { left: var(--space-4); bottom: var(--space-4); }
    :host([data-position='top-right']) { right: var(--space-4); top: var(--space-4); flex-direction: column-reverse; }
    :host([data-position='top-left']) { left: var(--space-4); top: var(--space-4); flex-direction: column-reverse; }
  `,
})
export class ToastOutletComponent {
  protected readonly service = inject(ToastService);
  readonly position = input<ToastOutletPosition>('bottom-right');
  /** Accessible name of each toast's close button. */
  readonly closeLabel = input<string>('Close');
}
