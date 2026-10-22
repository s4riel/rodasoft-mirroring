import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ContextBarComponent, IconComponent, SidebarComponent, StatusPillComponent } from '@rodasoft/ui';
import { AuthService } from '../core/auth/auth.service';
import { ContextStore } from '../core/context.store';
import { TenantService } from '../core/tenant.service';
import { ERP_NAV } from './navigation';

/** Base template 1 · Shell: Sidebar 248 px + ContextBar + content (max 1440 px). */
@Component({
  selector: 'rs-shell',
  imports: [RouterOutlet, SidebarComponent, ContextBarComponent, IconComponent, StatusPillComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <rs-sidebar [groups]="nav" [brandName]="tenant.name()" navLabel="Módulos">
      <div rsSidebarFooter class="siat">
        <span class="rs-eyebrow">SIAT</span>
        <!-- S2: real status (online / contingency) from /invoicing/status -->
        <rs-status-pill status="idle">Sin configurar</rs-status-pill>
      </div>
    </rs-sidebar>
    <div class="main">
      <rs-context-bar
        [company]="ctx.company()?.tradeName ?? tenant.name()"
        [branches]="ctx.branches()"
        [allowAll]="ctx.canViewAll()"
        [branchId]="ctx.branchId()"
        (branchIdChange)="ctx.setBranch($event)"
        companyLabel="Empresa"
        branchLabel="Sucursal"
        allLabel="Todas las sucursales"
        description="Empresa definida por la URL&#10;Sucursal según el usuario">
        <div rsContextActions class="actions">
          <button type="button" class="icon-btn" aria-label="Buscar (Ctrl + K)" title="Buscar (Ctrl + K)">
            <rs-icon name="search" />
          </button>
          <button type="button" class="icon-btn" aria-label="Alertas"><rs-icon name="bell" /></button>
          <div class="user">
            <span class="avatar" aria-hidden="true">{{ initials() }}</span>
            <span class="who">
              <strong>{{ auth.user()?.name }}</strong>
              <small class="rs-muted">{{ ctx.context()?.role?.name }}</small>
            </span>
            <button type="button" class="icon-btn" aria-label="Cerrar sesión" title="Cerrar sesión" (click)="auth.logout()">
              <rs-icon name="logout" />
            </button>
          </div>
        </div>
      </rs-context-bar>
      <main class="content"><router-outlet /></main>
    </div>
  `,
  styles: `
    :host { display: grid; grid-template-columns: var(--sidebar-width) 1fr; height: 100vh; }
    .main { display: grid; grid-template-rows: auto 1fr; min-width: 0; overflow: hidden; }
    .content { overflow: auto; padding: var(--space-8); }
    .content > * { max-width: var(--content-max); }
    .siat { display: grid; gap: var(--space-2); padding: var(--space-3); border-radius: var(--radius-md); background: var(--bg-surface-2); }
    .actions { display: flex; align-items: center; gap: var(--space-2); }
    .icon-btn {
      width: 40px; height: 40px; display: grid; place-items: center; border-radius: var(--radius-full);
      border: 0; background: transparent; color: var(--text-muted); cursor: pointer;
    }
    .icon-btn:hover { background: var(--bg-surface-2); color: var(--text-primary); }
    .user { display: flex; align-items: center; gap: var(--space-3); padding-left: var(--space-3); border-left: 1px solid var(--border-default); }
    .avatar {
      width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center;
      background: var(--action-primary); color: var(--action-on-primary); font-weight: 600; font-size: 13px;
    }
    .who { display: grid; line-height: 1.2; }
  `,
})
export class ShellComponent {
  protected readonly nav = ERP_NAV;
  protected readonly auth = inject(AuthService);
  protected readonly ctx = inject(ContextStore);
  protected readonly tenant = inject(TenantService);
  protected readonly initials = computed(() =>
    (this.auth.user()?.name ?? '?')
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join(''),
  );
}
