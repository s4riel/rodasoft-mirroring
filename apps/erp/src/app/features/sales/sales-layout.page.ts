import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NoteComponent, SubNavComponent, SubNavItem } from '@rodasoft/ui';
import { ContextStore } from '../../core/context.store';
import { canSeeSalesTab, SALES_TABS } from './sales-tabs';

/** Sales section: sub-navigation (Figma SubNav) + the active tab. Each tab shows only to those who hold its permission. */
@Component({
  selector: 'rs-sales-layout-page',
  imports: [NoteComponent, RouterOutlet, SubNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (noAccess()) {
      <rs-note type="warning" title="Sin acceso a ventas">
        Tu rol no tiene permisos para ninguna sección de ventas. Pide acceso a un administrador.
      </rs-note>
    } @else {
      <rs-sub-nav [items]="tabs()" label="Secciones de ventas" />
      <router-outlet />
    }
  `,
  styles: `
    :host { display: grid; gap: var(--space-6); }
  `,
})
export class SalesLayoutPage {
  private readonly ctx = inject(ContextStore);

  /** The context is loaded and the role holds no sales permission: there is nothing to show. */
  protected readonly noAccess = computed(() => !!this.ctx.context() && this.tabs().length === 0);

  protected readonly tabs = computed<SubNavItem[]>(() =>
    SALES_TABS.filter((tab) => canSeeSalesTab(tab, (p) => this.ctx.can(p))).map((tab) => ({
      key: tab.key,
      label: tab.label,
      route: `/sales/${tab.path}`,
    })),
  );
}
