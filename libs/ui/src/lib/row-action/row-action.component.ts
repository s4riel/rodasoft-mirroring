import { ChangeDetectionStrategy, Component, ElementRef, HostListener, inject, input, output, signal } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { RowMenuComponent, type RowMenuItem } from '../row-menu/row-menu.component';

/**
 * Figma: RowAction (39:4451) with its RowMenu. The round three-dots button at the end of a table row; it opens the menu of
 * the row's actions and emits the key of the chosen one. The parent decides which items the user may see, and the
 * accessible name (`label`, e.g. "Acciones de TR-000123"). Escape and a click outside close it.
 */
@Component({
  selector: 'rs-row-action',
  imports: [IconComponent, RowMenuComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './row-action.component.html',
  styleUrl: './row-action.component.scss',
})
export class RowActionComponent {
  readonly items = input.required<readonly RowMenuItem[]>();
  /** Accessible name of the button. */
  readonly label = input.required<string>();
  /** Emits the `key` of the chosen menu item. */
  readonly selected = output<string>();

  protected readonly open = signal(false);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected toggle(event: Event) {
    event.stopPropagation();
    this.open.update((value) => !value);
  }

  protected choose(key: string) {
    this.close();
    this.selected.emit(key);
  }

  /** Closes the menu and gives focus back to the button. */
  private close() {
    this.open.set(false);
    this.host.nativeElement.querySelector<HTMLElement>('.button')?.focus();
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: Event) {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  @HostListener('keydown.escape')
  protected onEscape() {
    if (this.open()) this.close();
  }
}
