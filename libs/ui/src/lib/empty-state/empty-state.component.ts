import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Basic empty state (Figma: EmptyState): icon slot, title, description and actions.
 * Slots: `[slot=icon]` (e.g. `<rs-icon name="search" size="24"/>`), default content = actions.
 */
@Component({
  selector: 'rs-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './empty-state.component.html',
  styleUrl: './empty-state.component.scss',
})
export class EmptyStateComponent {
  readonly heading = input<string>('');
  readonly description = input<string>('');
}
