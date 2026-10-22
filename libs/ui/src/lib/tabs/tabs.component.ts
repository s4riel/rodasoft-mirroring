import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, contentChildren, ElementRef, inject, input, model } from '@angular/core';
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
  template: `
    <div class="tablist" role="tablist" [attr.aria-label]="label() || null" (keydown)="onKeydown($event)">
      @for (tab of tabs(); track tab.value()) {
        <button
          type="button"
          role="tab"
          class="tab"
          [id]="tabId(tab)"
          [attr.aria-selected]="isActive(tab)"
          [attr.aria-controls]="panelId"
          [attr.tabindex]="isActive(tab) ? 0 : -1"
          [disabled]="tab.disabled()"
          (click)="select(tab)"
        >
          {{ tab.label() }}
        </button>
      }
    </div>
    @if (activeTab(); as active) {
      <div class="panel" role="tabpanel" tabindex="0" [id]="panelId" [attr.aria-labelledby]="tabId(active)">
        <ng-container [ngTemplateOutlet]="active.content()" />
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .tablist {
      display: flex;
      gap: var(--space-2);
      border-bottom: var(--stroke-default) solid var(--border-default);
    }
    .tab {
      display: inline-flex;
      align-items: center;
      height: var(--size-control-md);
      padding: 0 var(--space-4);
      margin-bottom: calc(-1 * var(--stroke-default));
      border: 0;
      border-bottom: var(--stroke-focus) solid transparent;
      border-radius: var(--radius-xs) var(--radius-xs) 0 0;
      background: transparent;
      color: var(--text-muted);
      font-family: var(--font-family-ui);
      font-size: var(--body-md-size);
      line-height: var(--body-md-line-height);
      font-weight: var(--body-md-weight);
      cursor: pointer;
      white-space: nowrap;
    }
    .tab:hover:not(:disabled) {
      color: var(--text-primary);
      background: var(--bg-surface-2);
    }
    .tab:active:not(:disabled) {
      background: var(--action-primary-soft);
    }
    .tab[aria-selected='true'] {
      color: var(--text-primary);
      font-weight: var(--body-md-strong-weight);
      border-bottom-color: var(--action-primary);
    }
    .tab:focus-visible {
      outline: var(--stroke-focus) solid var(--focus-control);
      outline-offset: calc(-1 * var(--stroke-focus));
    }
    .tab:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .panel {
      padding-top: var(--space-4);
    }
    .panel:focus-visible {
      outline: var(--stroke-focus) solid var(--focus-control);
      outline-offset: var(--focus-offset);
    }
  `,
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
    return tabs.find((t) => t.value() === this.selected() && !t.disabled()) ?? tabs.find((t) => !t.disabled()) ?? null;
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
    const buttons = Array.from(this.host.nativeElement.querySelectorAll<HTMLButtonElement>('button.tab:not(:disabled)'));
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
