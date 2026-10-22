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
  templateUrl: './steps.component.html',
  styleUrl: './steps.component.scss',
})
export class StepsComponent {
  /** Step labels (Spanish copy comes from the app). */
  readonly steps = input.required<readonly string[]>();
  /** 1-based current step (Figma `Current`). */
  readonly current = input(1);
  /** Accessible name of the list. */
  readonly label = input('');
}
