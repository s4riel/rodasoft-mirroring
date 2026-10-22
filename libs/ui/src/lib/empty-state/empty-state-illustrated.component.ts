import { booleanAttribute, ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IllustrationComponent } from './illustration.component';
import type { IllustrationName } from './illustrations';

export type EmptyStateIllustratedSize = 'page' | 'inline';

/**
 * Empty state with an illustration (Figma: EmptyState/Illustrated Size=Page 480|Inline 360, ShowAction).
 * `illustration` picks the Illustration/* artwork; the default slot holds the action(s) and is shown when `showAction`.
 */
@Component({
  selector: 'rs-empty-state-illustrated',
  imports: [IllustrationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-size]': 'size()' },
  templateUrl: './empty-state-illustrated.component.html',
  styleUrl: './empty-state-illustrated.component.scss',
})
export class EmptyStateIllustratedComponent {
  readonly size = input<EmptyStateIllustratedSize>('page');
  readonly illustration = input<IllustrationName>('no-results');
  readonly heading = input<string>('');
  readonly description = input<string>('');
  readonly showAction = input(true, { transform: booleanAttribute });
}
