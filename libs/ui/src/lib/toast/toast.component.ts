import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import type { IconName } from '../icon/icons';
import type { ToastType } from './toast.service';

/**
 * Toast card (Figma: Toast Type=Info|Success|Warning|Danger). Message via the default slot.
 * Use `ToastService` + `<rs-toast-outlet>` for the floating stack; this component is the visual unit.
 */
@Component({
  selector: 'rs-toast',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-type]': 'type()', '[attr.role]': "type() === 'danger' ? 'alert' : 'status'" },
  templateUrl: './toast.component.html',
  styleUrl: './toast.component.scss',
})
export class ToastComponent {
  readonly type = input<ToastType>('info');
  readonly heading = input<string>('');
  readonly dismissible = input(true, { transform: booleanAttribute });
  /** Accessible name of the close button. */
  readonly closeLabel = input<string>('Close');
  readonly dismissed = output<void>();

  protected readonly icon = computed<IconName>(() =>
    this.type() === 'success' ? 'check' : this.type() === 'info' ? 'info' : 'alert',
  );
}
