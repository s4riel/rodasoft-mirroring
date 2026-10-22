import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'rs-site-footer',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rs-container grid">
      <div>
        <p class="logo">{{ brand() }}</p>
        <p class="muted">Importación y distribución de rodamientos. Cochabamba, Bolivia.</p>
      </div>
      <nav aria-label="Pie de página">
        <a routerLink="/productos">Productos</a>
        <a routerLink="/nosotros">Nosotros</a>
        <a routerLink="/contacto">Sucursales y contacto</a>
      </nav>
      <p class="muted small">© {{ year }} {{ brand() }}. Todos los derechos reservados.</p>
    </div>
  `,
  styles: `
    :host { display: block; background: var(--bg-section-dark); color: var(--text-on-dark); padding: var(--space-12) 0; margin-top: var(--space-16); }
    .grid { display: grid; gap: var(--space-6); }
    .logo { font-weight: 600; letter-spacing: var(--tracking-logo); text-transform: uppercase; }
    nav { display: flex; gap: var(--space-5); flex-wrap: wrap; }
    nav a { color: #d0d0d4; text-decoration: none; } nav a:hover { color: #fff; }
    .muted { color: #9a9a9e; } .small { font-size: var(--text-sm); }
  `,
})
export class SiteFooterComponent {
  readonly brand = input('Rodalaser');
  protected readonly year = new Date().getFullYear();
}
