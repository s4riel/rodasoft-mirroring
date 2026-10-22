import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Basic empty state (Figma: EmptyState): icon slot, title, description and actions.
 * Slots: `[slot=icon]` (e.g. `<rs-icon name="search" size="24"/>`), default content = actions.
 */
@Component({
  selector: 'rs-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="icon"><ng-content select="[slot=icon]" /></div>
    @if (heading()) {
      <h3 class="title">{{ heading() }}</h3>
    }
    @if (description()) {
      <p class="description">{{ description() }}</p>
    }
    <div class="actions"><ng-content /></div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-8) var(--space-6);
      text-align: center;
    }
    .icon {
      display: inline-grid;
      place-items: center;
      width: 56px;
      height: 56px;
      margin-bottom: var(--space-2);
      border-radius: var(--radius-full);
      background: var(--bg-surface-2);
      color: var(--text-muted);
    }
    .icon:empty { display: none; }
    .title {
      font-size: var(--display-h3-size);
      line-height: var(--display-h3-line-height);
      font-weight: var(--display-h3-weight);
      color: var(--text-primary);
    }
    .description {
      max-width: 360px;
      font-size: var(--body-md-size);
      line-height: var(--body-md-line-height);
      color: var(--text-muted);
    }
    .actions { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-3); margin-top: var(--space-3); }
    .actions:empty { display: none; }
  `,
})
export class EmptyStateComponent {
  readonly heading = input<string>('');
  readonly description = input<string>('');
}
