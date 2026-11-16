import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SubNavComponent, SubNavItem } from '@rodasoft/ui';
import { ContextStore } from '../../core/context.store';
import { canSeeInvoicingTab, INVOICING_TABS } from './invoicing-tabs';

/** Invoicing section: sub-navigation (Figma SubNav) + the active tab. Each tab shows only to those who hold its permission. */
@Component({
  selector: 'rs-invoicing-layout-page',
  imports: [RouterOutlet, SubNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (tabs().length > 1) {
      <rs-sub-nav [items]="tabs()" label="Secciones de facturación" />
    }
    <router-outlet />
  `,
  styles: `
    :host { display: grid; gap: var(--space-6); }
  `,
})
export class InvoicingLayoutPage {
  private readonly ctx = inject(ContextStore);

  protected readonly tabs = computed<SubNavItem[]>(() =>
    INVOICING_TABS.filter((tab) => canSeeInvoicingTab(tab, (p) => this.ctx.can(p))).map((tab) => ({
      key: tab.key,
      label: tab.label,
      route: tab.path ? `/invoicing/${tab.path}` : '/invoicing',
      // `/invoicing` is a prefix of every other tab
      exact: tab.path === '',
    })),
  );
}
