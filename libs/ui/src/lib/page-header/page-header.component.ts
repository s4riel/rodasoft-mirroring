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
  templateUrl: './page-header.component.html',
  styleUrl: './page-header.component.scss',
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
