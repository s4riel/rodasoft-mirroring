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
  templateUrl: './stepper.component.html',
  styleUrl: './stepper.component.scss',
})
export class StepperComponent {
  readonly steps = input.required<readonly StepperStep[]>();
  /** 1-based current step (Figma `Current`). */
  readonly current = input(1);
  /** Accessible name of the list. */
  readonly label = input('');
}
