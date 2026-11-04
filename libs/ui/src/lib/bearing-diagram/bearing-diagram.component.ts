import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Bearing section drawing: outer ring labelled `D`, inner ring labelled `d` (HU-VEN-04). Extracted from the inventory product
 * sheet so that the POS sheet draws the same thing. It draws in `currentColor` and fills its box, so the parent sets the size,
 * the colour and the panel behind it. Decorative: the same measurements are always written next to it.
 * Not in Figma as a component yet: flagged as "estimated" in `docs/ui-library.md`.
 *   <rs-bearing-diagram outerDiameter="52" innerDiameter="25" />
 */
@Component({
  selector: 'rs-bearing-diagram',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  templateUrl: './bearing-diagram.component.html',
  styleUrl: './bearing-diagram.component.scss',
})
export class BearingDiagramComponent {
  /** Outer diameter as it is written next to the `D` ("52", "52 mm"). */
  readonly outerDiameter = input.required<string>();
  /** Inner diameter as it is written next to the `d`. */
  readonly innerDiameter = input.required<string>();
}
