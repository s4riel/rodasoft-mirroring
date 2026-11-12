import { afterNextRender, booleanAttribute, ChangeDetectionStrategy, Component, ElementRef, inject, Injector, input, output, viewChild } from '@angular/core';

/**
 * Figma: "Arrastrar ítem" (ERP file `372:22949`, 14 × 30): the six-dot grip at the left of a draggable line (HU-VEN-33). It
 * only draws the grip and handles the keyboard; the screen makes the line draggable (for example with the CDK's
 * `cdkDragHandle` on this element) and moves it. ArrowUp and ArrowDown emit `moveUp` and `moveDown` so a line can be
 * reordered without a pointer.
 *   <rs-drag-handle cdkDragHandle label="Arrastrar 6205-2RS" (moveUp)="up(line)" (moveDown)="down(line)" />
 */
@Component({
  selector: 'rs-drag-handle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './drag-handle.component.html',
  styleUrl: './drag-handle.component.scss',
})
export class DragHandleComponent {
  /** Accessible name ("Arrastrar 6205-2RS"). */
  readonly label = input.required<string>();
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly button = viewChild.required<ElementRef<HTMLButtonElement>>('grip');
  private readonly injector = inject(Injector);

  readonly moveUp = output<void>();
  readonly moveDown = output<void>();

  protected onKeydown(event: KeyboardEvent): void {
    if (this.disabled()) return;
    if (event.key === 'ArrowUp') this.moveUp.emit();
    else if (event.key === 'ArrowDown') this.moveDown.emit();
    else return;
    // the arrows move the line, not the page
    event.preventDefault();
    // the list is drawn again with the line in its new place: the grip keeps the focus so the next arrow press works
    afterNextRender(() => this.button().nativeElement.focus(), { injector: this.injector });
  }
}
