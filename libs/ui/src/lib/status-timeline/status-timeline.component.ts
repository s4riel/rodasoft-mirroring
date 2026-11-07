import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type StatusTimelineState = 'done' | 'current' | 'warning' | 'pending';

export interface StatusTimelineStep {
  label: string;
  /** Secondary line: a date, or "—" while the step has not happened. */
  caption?: string;
  state: StatusTimelineState;
  /** Spoken state ("Vencida", "Completado"…), visually hidden. The library keeps no copy of its own. */
  stateLabel?: string;
}

/**
 * The horizontal status timeline of a document (Figma VP-17 and VP-17b "Estados": a dot, a label and a caption per step,
 * joined by a line). Unlike `rs-stepper` it is read-only, shows a date under each step and has a warning state for the
 * step where the document stopped (expired, rejected).
 */
@Component({
  selector: 'rs-status-timeline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './status-timeline.component.html',
  styleUrl: './status-timeline.component.scss',
})
export class StatusTimelineComponent {
  readonly steps = input.required<readonly StatusTimelineStep[]>();
  /** Accessible name of the list. */
  readonly label = input('');
}
