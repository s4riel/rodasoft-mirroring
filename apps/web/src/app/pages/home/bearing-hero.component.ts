import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Placeholder for the hero bearing on the Home page.
 * S3: replace with the Three.js scene (Draco-optimized .glb model) that explodes on scroll
 * (GSAP ScrollTrigger), loaded only in the browser with @defer (on viewport) so it does not affect SSR or LCP.
 * Meanwhile: an SVG that spins with the scroll using CSS scroll-driven animations (progressive enhancement).
 */
@Component({
  selector: 'rs-bearing-hero',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 400 400" role="img" aria-label="Rodamiento de bolas">
      <defs>
        <radialGradient id="steel" cx="35%" cy="30%" r="80%">
          <stop offset="0%" stop-color="#f4f5f7" />
          <stop offset="55%" stop-color="#b9bfc6" />
          <stop offset="100%" stop-color="#6f7780" />
        </radialGradient>
      </defs>
      <circle cx="200" cy="200" r="180" fill="url(#steel)" />
      <circle cx="200" cy="200" r="150" fill="#2b2f34" />
      <g class="balls">
        @for (a of angles; track a) {
          <circle [attr.cx]="200 + 122 * cos(a)" [attr.cy]="200 + 122 * sin(a)" r="24" fill="url(#steel)" />
        }
      </g>
      <circle cx="200" cy="200" r="95" fill="url(#steel)" />
      <circle cx="200" cy="200" r="62" fill="var(--bg-section-alt)" />
    </svg>
  `,
  styles: `
    :host { display: block; width: min(80vw, 520px); aspect-ratio: 1; margin-inline: auto; filter: drop-shadow(0 30px 40px rgba(0,0,0,.18)); }
    svg { width: 100%; height: 100%; }
    .balls { transform-origin: 200px 200px; }
    @supports (animation-timeline: scroll()) {
      .balls { animation: spin linear both; animation-timeline: scroll(root); }
      @keyframes spin { to { transform: rotate(360deg); } }
    }
  `,
})
export class BearingHeroComponent {
  protected readonly angles = Array.from({ length: 9 }, (_, i) => (i * 2 * Math.PI) / 9);
  protected readonly cos = Math.cos;
  protected readonly sin = Math.sin;
}
