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
  templateUrl: './toast-outlet.component.html',
  styleUrl: './toast-outlet.component.scss',
})
export class ToastOutletComponent {
  protected readonly service = inject(ToastService);
  readonly position = input<ToastOutletPosition>('bottom-right');
  /** Accessible name of each toast's close button. */
  readonly closeLabel = input<string>('Close');
}
