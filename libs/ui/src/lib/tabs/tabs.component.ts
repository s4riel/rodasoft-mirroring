import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChildren,
  ElementRef,
  inject,
  input,
  model,
} from '@angular/core';
import { TabComponent } from './tab.component';

let nextId = 0;

/**
 * Figma: Tabs Active=Products|Specs|Compatibility x State (Default/Hover/Pressed/Focus/Disabled).
 * `selected` is the Active property; the states are CSS (`:hover`, `:active`, `:focus-visible`, `:disabled`).
 * Keyboard: ArrowLeft/ArrowRight/Home/End move and select (roving tabindex).
 */
@Component({
  selector: 'rs-tabs',
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tabs.component.html',
  styleUrl: './tabs.component.scss',
})
export class TabsComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly uid = `rs-tabs-${nextId++}`;
  protected readonly panelId = `${this.uid}-panel`;

  /** Value of the active tab (Figma `Active`). Defaults to the first enabled tab. */
  readonly selected = model<string | undefined>(undefined);
  /** Accessible name of the tablist. */
  readonly label = input('');

  protected readonly tabs = contentChildren(TabComponent);
  protected readonly activeTab = computed(() => {
    const tabs = this.tabs();
    return (
      tabs.find((t) => t.value() === this.selected() && !t.disabled()) ??
      tabs.find((t) => !t.disabled()) ??
      null
    );
  });

  protected tabId(tab: TabComponent): string {
    return `${this.uid}-tab-${tab.value()}`;
  }

  protected isActive(tab: TabComponent): boolean {
    return this.activeTab() === tab;
  }

  protected select(tab: TabComponent): void {
    if (!tab.disabled()) {
      this.selected.set(tab.value());
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) {
      return;
    }
    const buttons = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLButtonElement>('button.tab:not(:disabled)'),
    );
    if (!buttons.length) {
      return;
    }
    const current = buttons.findIndex((b) => b === document.activeElement);
    let next = current < 0 ? 0 : current;
    if (event.key === 'ArrowRight') next = (current + 1) % buttons.length;
    if (event.key === 'ArrowLeft') next = (current - 1 + buttons.length) % buttons.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = buttons.length - 1;
    event.preventDefault();
    buttons[next].focus();
    buttons[next].click();
  }
}
