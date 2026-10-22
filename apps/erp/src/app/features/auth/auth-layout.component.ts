import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TenantService } from '../../core/tenant.service';

/** Frame for the access screens (BC-01 to BC-04): brand panel + form. */
@Component({
  selector: 'rs-auth-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="brand-panel">
      <div class="logo">
        <span>{{ tenant.name() }}</span>
        <span class="bar" aria-hidden="true"></span>
      </div>
      <div class="claim">
        <p class="rs-eyebrow">Sistema de gestión</p>
        <h2>Inventario, ventas y facturación en un solo lugar.</h2>
      </div>
      <p class="foot">© {{ year }} {{ tenant.name() }}</p>
    </aside>
    <main class="form-panel">
      <div class="form-wrap"><ng-content /></div>
    </main>
  `,
  styles: `
    :host { display: grid; grid-template-columns: minmax(360px, 5fr) 7fr; min-height: 100vh; background: var(--bg-surface); }
    .brand-panel {
      display: flex; flex-direction: column; justify-content: space-between; padding: var(--space-12);
      background: var(--bg-section-dark); color: var(--text-on-dark);
    }
    .logo { display: inline-grid; gap: 6px; font-weight: 600; letter-spacing: var(--tracking-logo); text-transform: uppercase; }
    .bar { width: 36px; height: 3px; border-radius: 2px; background: var(--brand-primary); }
    .claim { display: grid; gap: var(--space-3); max-width: 420px; }
    .claim h2 { font-size: 40px; line-height: 1.05; }
    .claim .rs-eyebrow { color: #9a9a9e; }
    .foot { color: #9a9a9e; font-size: var(--text-sm); }
    .form-panel { display: grid; place-items: center; padding: var(--space-8); }
    .form-wrap { width: 100%; max-width: 400px; }
    @media (max-width: 860px) {
      :host { grid-template-columns: 1fr; }
      .brand-panel { padding: var(--space-6); min-height: 160px; }
      .claim h2 { font-size: 26px; }
      .foot { display: none; }
    }
  `,
})
export class AuthLayoutComponent {
  protected readonly tenant = inject(TenantService);
  protected readonly year = new Date().getFullYear();
}
