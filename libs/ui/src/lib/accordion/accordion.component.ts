import { booleanAttribute, ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

let nextId = 0;

/**
 * Figma: Accordion Open=Off|On x State (Default/Hover/Focus/Disabled).
 * One collapsible section: `title` + projected content. `open` is two-way (Figma `Open`).
 */
@Component({
  selector: 'rs-accordion',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './accordion.component.html',
  styleUrl: './accordion.component.scss',
})
export class AccordionComponent {
  private readonly uid = `rs-accordion-${nextId++}`;
  protected readonly triggerId = `${this.uid}-trigger`;
  protected readonly panelId = `${this.uid}-panel`;

  readonly title = input.required<string>();
  /** Figma `Open=On|Off`. */
  readonly open = model(false);
  readonly disabled = input(false, { transform: booleanAttribute });
}
