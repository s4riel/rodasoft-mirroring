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
  template: `
    <rs-illustration [name]="illustration()" />
    <h3 class="title">{{ heading() }}</h3>
    @if (description()) {
      <p class="description">{{ description() }}</p>
    }
    @if (showAction()) {
      <div class="actions"><ng-content /></div>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-2);
      width: 100%;
      max-width: 480px; /* Figma Size=Page */
      margin-inline: auto;
      padding: var(--space-8) var(--space-6);
      text-align: center;
    }
    :host([data-size='inline']) { max-width: 360px; padding: var(--space-6) var(--space-4); }
    rs-illustration { margin-bottom: var(--space-4); }
    .title {
      font-size: var(--display-h3-size);
      line-height: var(--display-h3-line-height);
      font-weight: var(--display-h3-weight);
      color: var(--text-primary);
    }
    :host([data-size='page']) .title {
      font-size: var(--display-h2-size);
      line-height: var(--display-h2-line-height);
      font-weight: var(--display-h2-weight);
      letter-spacing: var(--display-h2-tracking);
    }
    .description { font-size: var(--body-md-size); line-height: var(--body-md-line-height); color: var(--text-muted); }
    .actions { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-3); margin-top: var(--space-4); }
  `,
})
export class EmptyStateIllustratedComponent {
  readonly size = input<EmptyStateIllustratedSize>('page');
  readonly illustration = input<IllustrationName>('no-results');
  readonly heading = input<string>('');
  readonly description = input<string>('');
  readonly showAction = input(true, { transform: booleanAttribute });
}
