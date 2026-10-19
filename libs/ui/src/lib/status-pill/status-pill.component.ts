import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type Status = 'success' | 'warning' | 'danger' | 'info' | 'idle';

/** Estado = color + punto + texto (nunca solo color). Figma: StatusPill Status=… */
@Component({
  selector: 'rs-status-pill',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-status]': 'status()' },
  template: `<span class="dot" aria-hidden="true"></span><ng-content />`,
  styles: `
    :host {
      --_c: var(--status-idle); --_bg: var(--bg-surface-2);
      display: inline-flex; align-items: center; gap: 6px;
      height: 24px; padding: 0 10px; border-radius: var(--radius-full);
      font-size: var(--text-sm); font-weight: 600; color: var(--_c); background: var(--_bg);
    }
    :host([data-status='success']) { --_c: var(--status-success); --_bg: var(--status-success-soft); }
    :host([data-status='warning']) { --_c: var(--status-warning); --_bg: var(--status-warning-soft); }
    :host([data-status='danger']) { --_c: var(--status-danger); --_bg: var(--status-danger-soft); }
    :host([data-status='info']) { --_c: var(--status-info); --_bg: var(--status-info-soft); }
    .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  `,
})
export class StatusPillComponent {
  readonly status = input<Status>('idle');
}
