import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

export interface Breadcrumb {
  label: string;
  link?: string;
}

/** Encabezado de página (Figma: PageHeader Type=List|Detail|Form). Acciones vía <ng-content select="[rsActions]">. */
@Component({
  selector: 'rs-page-header',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (breadcrumbs().length) {
      <nav class="crumbs" aria-label="Migas de pan">
        @for (b of breadcrumbs(); track b.label; let last = $last) {
          @if (b.link && !last) {
            <a [routerLink]="b.link">{{ b.label }}</a><span aria-hidden="true">/</span>
          } @else {
            <span [attr.aria-current]="last ? 'page' : null">{{ b.label }}</span>
          }
        }
      </nav>
    }
    <div class="row">
      <div class="titles">
        <h1>{{ title() }}</h1>
        @if (subtitle()) {
          <p class="rs-muted">{{ subtitle() }}</p>
        }
      </div>
      <div class="actions"><ng-content select="[rsActions]" /></div>
    </div>
  `,
  styles: `
    :host { display: grid; gap: var(--space-2); margin-bottom: var(--space-6); }
    .crumbs { display: flex; gap: var(--space-2); font-size: var(--text-sm); color: var(--text-muted); }
    .crumbs a { text-decoration: none; } .crumbs a:hover { text-decoration: underline; }
    .row { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap; }
    .titles { display: grid; gap: var(--space-1); }
    .actions { display: flex; gap: var(--space-2); }
  `,
})
export class PageHeaderComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string>();
  readonly breadcrumbs = input<Breadcrumb[]>([]);
}
