import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent, IconComponent } from '@rodasoft/ui';
import { BearingHeroComponent } from './bearing-hero.component';

/** Home: product as hero (Apple style), big numbers and a white / gray / black section rhythm. */
@Component({
  selector: 'rs-home-page',
  imports: [RouterLink, ButtonComponent, IconComponent, BearingHeroComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="hero">
      <div class="rs-container center">
        <p class="rs-eyebrow">Rodamientos para Bolivia</p>
        <h1>Precisión que no se detiene.</h1>
        <p class="lead">Rodamientos para transporte pesado, minería, agro e industria, con stock en cada sucursal.</p>
        <div class="ctas">
          <a rsButton variant="brand" size="lg" routerLink="/contacto">Cotizar</a>
          <a class="more" routerLink="/productos">Ver catálogo <rs-icon name="chevron-right" [size]="16" /></a>
        </div>
      </div>
      <rs-bearing-hero />
    </section>

    <section class="stats">
      <div class="rs-container grid">
        @for (s of stats; track s.label) {
          <div>
            <p class="stat">{{ s.value }}</p>
            <p class="muted">{{ s.label }}</p>
          </div>
        }
      </div>
    </section>

    <section class="dark">
      <div class="rs-container center">
        <p class="rs-eyebrow">Encuentra tu rodamiento</p>
        <h2>Busca por código, marca o medida.<br />Y por su equivalente.</h2>
        <p class="lead">El mismo rodamiento en otras marcas, con sus diferencias claras. Lo trae el catálogo de S3.</p>
      </div>
    </section>
  `,
  styles: `
    .center { text-align: center; display: grid; justify-items: center; gap: var(--space-4); }
    .hero { background: var(--bg-surface); padding: var(--space-16) 0 var(--space-12); display: grid; gap: var(--space-10); }
    h1 { font-size: clamp(44px, 7vw, var(--text-display-hero)); line-height: 1.05; max-width: 14ch; }
    h2 { font-size: clamp(32px, 4.5vw, var(--text-display-xl)); line-height: 1.05; }
    .lead { font-size: 19px; color: var(--text-muted); max-width: 46ch; }
    .ctas { display: flex; gap: var(--space-5); align-items: center; margin-top: var(--space-2); }
    .more { display: inline-flex; align-items: center; gap: 4px; color: var(--status-info); text-decoration: none; font-weight: 500; }
    .stats { background: var(--bg-section-alt); padding: var(--space-16) 0; }
    .stats .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--space-8); text-align: center; }
    .stat { font-size: 64px; font-weight: 600; letter-spacing: var(--tracking-tight); line-height: 1; }
    .muted { color: var(--text-muted); }
    .dark { background: var(--bg-section-dark); color: var(--text-on-dark); padding: var(--space-16) 0; }
    .dark .lead, .dark .rs-eyebrow { color: #a1a1a6; }
  `,
})
export class HomePage {
  // PROVISIONAL figures: confirm with the client (Phase 0)
  protected readonly stats = [
    { value: '3', label: 'sucursales en Cochabamba' },
    { value: '5', label: 'marcas importadas' },
    { value: '22', label: 'familias de producto' },
  ];
}
