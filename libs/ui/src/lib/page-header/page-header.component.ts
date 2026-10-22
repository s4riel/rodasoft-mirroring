import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { BreadcrumbComponent, BreadcrumbItem } from '../breadcrumb/breadcrumb.component';

/** Kept for backwards compatibility: same shape as `BreadcrumbItem`. */
export type Breadcrumb = BreadcrumbItem;

export type PageHeaderType = 'list' | 'detail' | 'form' | 'list-import';

/**
 * Figma: PageHeader Type=List|Detail|Form|ListImport: breadcrumb, title (display/h3), description and actions.
 * The Type decides which buttons the screen projects into `[rsActions]`:
 * List: Export + primary action; Detail: status pill in `[rsStatus]` + actions; Form: Cancel + Save;
 * ListImport: Import + Export + New. The component only provides the slots and the `data-type` hook.
 */
@Component({
  selector: 'rs-page-header',
  imports: [BreadcrumbComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-type]': 'type()' },
  template: `
    <div class="heading">
      @if (breadcrumbs().length) {
        <rs-breadcrumb [items]="breadcrumbs()" [label]="breadcrumbLabel()" />
      }
      <div class="title-row">
        <h1 class="title">{{ title() }}</h1>
        <ng-content select="[rsStatus]" />
      </div>
      @if (text()) {
        <p class="description">{{ text() }}</p>
      }
    </div>
    <div class="actions"><ng-content select="[rsActions]" /></div>
  `,
  styles: `
    :host {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: var(--space-4);
      padding-bottom: var(--space-6);
    }
    .heading {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-2);
      min-width: 0;
    }
    .title-row {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }
    .title {
      margin: 0;
      font-family: var(--font-family-ui);
      font-size: var(--display-h3-size);
      line-height: var(--display-h3-line-height);
      font-weight: var(--display-h3-weight);
      letter-spacing: var(--display-h3-tracking);
      color: var(--text-primary);
    }
    .description {
      margin: 0;
      color: var(--text-muted);
      font-size: var(--body-md-size);
      line-height: var(--body-md-line-height);
    }
    .actions {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }
    .actions:empty {
      display: none;
    }
  `,
})
export class PageHeaderComponent {
  readonly title = input.required<string>();
  /** Figma `Description`. */
  readonly description = input('');
  /** @deprecated use `description`. */
  readonly subtitle = input('');
  readonly breadcrumbs = input<readonly BreadcrumbItem[]>([]);
  /** Accessible name of the breadcrumb landmark. */
  readonly breadcrumbLabel = input('');
  /** Figma `Type`. */
  readonly type = input<PageHeaderType>('list');

  protected readonly text = computed(() => this.description() || this.subtitle());
}
