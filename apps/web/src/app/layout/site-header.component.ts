import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { IconComponent } from '@rodasoft/ui';

/** Site/Header: links on the left, centered logo, search, cart and account on the right. */
@Component({
  selector: 'rs-site-header',
  imports: [RouterLink, RouterLinkActive, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="skip" href="#main-content">Saltar al contenido</a>
    <div class="bar rs-container">
      <nav aria-label="Principal">
        @for (l of links; track l.path) {
          <a [routerLink]="l.path" routerLinkActive="active">{{ l.label }}</a>
        }
      </nav>
      <a class="logo" routerLink="/" [attr.aria-label]="brand() + ', inicio'">
        <span>{{ brand() }}</span><span class="logo-bar" aria-hidden="true"></span>
      </a>
      <div class="tools">
        <a routerLink="/productos" aria-label="Buscar por código de rodamiento"><rs-icon name="search" /></a>
        <a routerLink="/carrito" aria-label="Carrito"><rs-icon name="cart" /></a>
        <a routerLink="/contacto" aria-label="Mi cuenta"><rs-icon name="user" /></a>
      </div>
    </div>
  `,
  styles: `
    :host {
      position: sticky; top: 0; z-index: 20; display: block;
      background: color-mix(in srgb, var(--bg-surface) 82%, transparent);
      backdrop-filter: saturate(180%) blur(16px); border-bottom: 1px solid var(--border-default);
    }
    .bar { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; height: 64px; }
    nav { display: flex; gap: var(--space-5); font-size: 14px; }
    nav a { text-decoration: none; color: var(--text-muted); font-weight: 500; }
    nav a.active, nav a:hover { color: var(--text-primary); font-weight: 600; }
    .logo { display: inline-grid; justify-items: center; gap: 3px; text-decoration: none; font-weight: 600; letter-spacing: var(--tracking-logo); text-transform: uppercase; font-size: 14px; }
    .logo-bar { width: 24px; height: 2px; background: var(--brand-primary); border-radius: 2px; }
    .tools { display: flex; justify-content: flex-end; gap: var(--space-2); }
    .tools a { width: 40px; height: 40px; display: grid; place-items: center; border-radius: var(--radius-full); }
    .tools a:hover { background: var(--bg-surface-2); }
    .skip { position: absolute; left: -999px; } .skip:focus { left: 16px; top: 12px; background: var(--bg-surface); padding: 8px 12px; border-radius: 8px; }
    @media (max-width: 960px) {
      .bar { grid-template-columns: auto 1fr; }
      nav { display: none; } /* S3: fixed bottom bar on mobile (Figma mobile templates) */
      .logo { justify-items: start; }
    }
  `,
})
export class SiteHeaderComponent {
  readonly brand = input('Rodalaser');
  protected readonly links = [
    { path: '/productos', label: 'Productos' },
    { path: '/marcas', label: 'Marcas' },
    { path: '/sectores', label: 'Sectores' },
    { path: '/nosotros', label: 'Nosotros' },
    { path: '/novedades', label: 'Novedades' },
    { path: '/contacto', label: 'Contacto' },
  ];
}
