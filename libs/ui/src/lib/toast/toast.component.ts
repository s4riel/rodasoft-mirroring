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
  template: `
    <span class="icon"><rs-icon [name]="icon()" [size]="20" /></span>
    <div class="body">
      @if (heading()) {
        <strong>{{ heading() }}</strong>
      }
      <div class="text"><ng-content /></div>
    </div>
    @if (dismissible()) {
      <button type="button" class="close" [attr.aria-label]="closeLabel()" (click)="dismissed.emit()">
        <rs-icon name="close" [size]="16" />
      </button>
    }
  `,
  styles: `
    :host {
      --_c: var(--status-info);
      --_bg: var(--status-info-soft);
      display: flex;
      align-items: flex-start;
      gap: var(--space-3);
      width: 100%;
      max-width: 400px;
      padding: var(--space-3) var(--space-4);
      border-radius: var(--radius-lg);
      background: var(--bg-surface);
      box-shadow: var(--shadow-modal), inset 0 0 0 var(--stroke-default) var(--border-default);
      color: var(--text-primary);
      font-size: var(--body-md-size);
      line-height: var(--body-md-line-height);
    }
    :host([data-type='success']) { --_c: var(--status-success); --_bg: var(--status-success-soft); }
    :host([data-type='warning']) { --_c: var(--status-warning); --_bg: var(--status-warning-soft); }
    :host([data-type='danger']) { --_c: var(--status-danger); --_bg: var(--status-danger-soft); }
    .icon {
      display: inline-grid;
      place-items: center;
      flex: none;
      width: 28px;
      height: 28px;
      margin: -2px 0;
      border-radius: var(--radius-full);
      background: var(--_bg);
      color: var(--_c);
    }
    .body { flex: 1; display: grid; gap: 2px; min-width: 0; padding-top: 2px; }
    strong { font-weight: var(--body-md-strong-weight); }
    .text { color: var(--text-muted); }
    .close {
      flex: none;
      display: inline-grid;
      place-items: center;
      width: 28px;
      height: 28px;
      margin: -2px -6px -2px 0;
      border: 0;
      border-radius: var(--radius-full);
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
    }
    .close:hover { background: var(--bg-surface-2); color: var(--text-primary); }
    .close:focus-visible { outline: var(--stroke-focus) solid var(--focus-control); outline-offset: var(--focus-offset); }
  `,
})
export class ToastComponent {
  readonly type = input<ToastType>('info');
  readonly heading = input<string>('');
  readonly dismissible = input(true, { transform: booleanAttribute });
  /** Accessible name of the close button. */
  readonly closeLabel = input<string>('Close');
  readonly dismissed = output<void>();

  protected readonly icon = computed<IconName>(() => (this.type() === 'success' ? 'check' : this.type() === 'info' ? 'info' : 'alert'));
}
