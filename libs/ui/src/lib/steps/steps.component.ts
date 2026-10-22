import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

/**
 * Figma: Steps Current=1|2|3. Numbered circles joined by connectors:
 * done (check), current (filled number) and upcoming (outlined number).
 * Same visual language as the ERP `rs-stepper`, without requirement tags.
 */
@Component({
  selector: 'rs-steps',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ol [attr.aria-label]="label() || null">
      @for (step of steps(); track $index; let i = $index; let last = $last) {
        <li
          class="step"
          [class.done]="i + 1 < current()"
          [class.current]="i + 1 === current()"
          [attr.aria-current]="i + 1 === current() ? 'step' : null"
        >
          <span class="circle">
            @if (i + 1 < current()) {
              <rs-icon name="check" [size]="16" />
            } @else {
              {{ i + 1 }}
            }
          </span>
          <span class="text">{{ step }}</span>
        </li>
        @if (!last) {
          <li class="connector" [class.done]="i + 1 < current()" aria-hidden="true"></li>
        }
      }
    </ol>
  `,
  styles: `
    :host {
      display: block;
    }
    ol {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .step {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      color: var(--text-muted);
      white-space: nowrap;
    }
    .circle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 32px; /* Figma circle size, no token */
      height: 32px;
      border-radius: var(--radius-full);
      border: var(--stroke-default) solid var(--border-default);
      background: var(--bg-surface);
      color: var(--text-muted);
      font-size: var(--body-md-strong-size);
      line-height: var(--body-md-strong-line-height);
      font-weight: var(--body-md-strong-weight);
    }
    .done .circle,
    .current .circle {
      background: var(--text-primary);
      border-color: var(--text-primary);
      color: var(--bg-surface);
    }
    .text {
      font-size: var(--body-md-strong-size);
      line-height: var(--body-md-strong-line-height);
      font-weight: var(--body-md-strong-weight);
    }
    .done .text,
    .current .text {
      color: var(--text-primary);
    }
    .connector {
      flex: 1 0 var(--space-6);
      height: 2px; /* Figma connector thickness, no token */
      background: var(--border-default);
    }
    .connector.done {
      background: var(--text-primary);
    }
  `,
})
export class StepsComponent {
  /** Step labels (Spanish copy comes from the app). */
  readonly steps = input.required<readonly string[]>();
  /** 1-based current step (Figma `Current`). */
  readonly current = input(1);
  /** Accessible name of the list. */
  readonly label = input('');
}
