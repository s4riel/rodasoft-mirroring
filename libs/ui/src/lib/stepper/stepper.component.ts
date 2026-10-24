import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

export interface StepperStep {
  label: string;
  /** Secondary line, e.g. "Requerido" / "Opcional". */
  tag?: string;
}

/**
 * Figma: Stepper (6 steps, Current=1..6) and Stepper4 (4 steps, Current=1..4), built from StepperItem
 * (Done | Current | Upcoming). One component for both: the number of steps is the length of `steps`.
 *
 * By default the steps before `current` are Done. An edit flow (every step already filled) passes `completed` to mark
 * steps Done wherever they are, and `interactive` to let the user jump to any step.
 */
@Component({
  selector: 'rs-stepper',
  imports: [IconComponent, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stepper.component.html',
  styleUrl: './stepper.component.scss',
})
export class StepperComponent {
  readonly steps = input.required<readonly StepperStep[]>();
  /** 1-based current step (Figma `Current`). */
  readonly current = input(1);
  /** Accessible name of the list. */
  readonly label = input('');
  /** 1-based steps shown as Done whatever the current step; `null` keeps "every step before the current one". */
  readonly completed = input<readonly number[] | null>(null);
  /** Each step becomes a button that emits `stepSelected`. */
  readonly interactive = input(false);
  /** 1-based step the user picked. */
  readonly stepSelected = output<number>();

  protected isDone(step: number): boolean {
    const completed = this.completed();
    if (completed) return step !== this.current() && completed.includes(step);
    return step < this.current();
  }
}
