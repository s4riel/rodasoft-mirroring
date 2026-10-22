import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

export interface StepperStep {
  label: string;
  /** Secondary line, e.g. "Requerido" / "Opcional". */
  tag?: string;
}

/**
 * Figma: Stepper (6 steps, Current=1..6) and Stepper4 (4 steps, Current=1..4), built from StepperItem
 * (Done | Current | Upcoming). One component for both: the number of steps is the length of `steps`.
 */
@Component({
  selector: 'rs-stepper',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ol [attr.aria-label]="label() || null">
      @for (step of steps(); track $index; let i = $index; let last = $last) {
        <li
          class="item"
          [class.done]="i + 1 < current()"
          [class.current]="i + 1 === current()"
          [class.upcoming]="i + 1 > current()"
          [attr.aria-current]="i + 1 === current() ? 'step' : null"
        >
          <span class="circle">
            @if (i + 1 < current()) {
              <rs-icon name="check" [size]="16" />
            } @else {
              {{ i + 1 }}
            }
          </span>
          <span class="text">
            <span class="label">{{ step.label }}</span>
            @if (step.tag) {
              <span class="tag">{{ step.tag }}</span>
            }
          </span>
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
      min-height: var(--size-control-md);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .item {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      flex: none;
      white-space: nowrap;
    }
    .circle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 32px; /* Figma circle size, no token */
      height: 32px;
      overflow: hidden;
      border-radius: var(--radius-full);
      background: var(--text-primary);
      color: var(--bg-surface);
      font-size: var(--body-md-strong-size);
      line-height: var(--body-md-strong-line-height);
      font-weight: var(--body-md-strong-weight);
    }
    .upcoming .circle {
      background: var(--bg-surface);
      border: var(--stroke-default) solid var(--border-default);
      color: var(--text-muted);
    }
    .text {
      display: flex;
      flex-direction: column;
    }
    .label {
      font-size: var(--body-md-strong-size);
      line-height: var(--body-md-strong-line-height);
      font-weight: var(--body-md-strong-weight);
      letter-spacing: var(--body-md-strong-tracking);
      color: var(--text-primary);
    }
    .tag {
      font-size: var(--body-sm-size);
      line-height: var(--body-sm-line-height);
      font-weight: var(--body-sm-weight);
      color: var(--text-muted);
    }
    .upcoming .label {
      color: var(--text-muted);
    }
    .connector {
      flex: 1 0 var(--space-4);
      min-width: 1px;
      height: 2px; /* Figma connector thickness, no token */
      background: var(--border-default);
    }
    .connector.done {
      background: var(--text-primary);
    }
  `,
})
export class StepperComponent {
  readonly steps = input.required<readonly StepperStep[]>();
  /** 1-based current step (Figma `Current`). */
  readonly current = input(1);
  /** Accessible name of the list. */
  readonly label = input('');
}
