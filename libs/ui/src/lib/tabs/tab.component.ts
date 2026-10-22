import { booleanAttribute, ChangeDetectionStrategy, Component, input, TemplateRef, viewChild } from '@angular/core';

/** One tab of `<rs-tabs>`: `<rs-tab value="specs" label="...">panel content</rs-tab>`. */
@Component({
  selector: 'rs-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-template #content><ng-content /></ng-template>`,
  styles: `
    :host {
      display: none;
    }
  `,
})
export class TabComponent {
  /** Identifier used by `<rs-tabs [(selected)]>`. */
  readonly value = input.required<string>();
  /** Visible tab label (Spanish copy comes from the app). */
  readonly label = input.required<string>();
  readonly disabled = input(false, { transform: booleanAttribute });
  /** Panel content, rendered by the parent `rs-tabs` only while the tab is active. */
  readonly content = viewChild.required<TemplateRef<unknown>>('content');
}
