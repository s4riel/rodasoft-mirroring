import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

export type FlagCountry = 'DE' | 'CN' | 'JP' | 'SE' | 'US' | 'ES' | 'IT' | 'FR' | 'BR' | 'BO' | 'AR' | 'IN' | 'KR' | 'TW';

export const FLAG_COUNTRIES: readonly FlagCountry[] = ['DE', 'CN', 'JP', 'SE', 'US', 'ES', 'IT', 'FR', 'BR', 'BO', 'AR', 'IN', 'KR', 'TW'];

/** Regular star polygon points (5 points) centred on (cx, cy). */
function star(cx: number, cy: number, r: number, rotation = -90): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : r * 0.4;
    const angle = ((rotation + i * 36) * Math.PI) / 180;
    pts.push(`${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return pts.join(' ');
}

function usStripes(): string {
  let out = '<rect width="20" height="14" fill="#FFFFFF"/>';
  const h = 14 / 13;
  for (let i = 0; i < 13; i += 2) {
    out += `<rect y="${(i * h).toFixed(3)}" width="20" height="${h.toFixed(3)}" fill="#B22234"/>`;
  }
  out += '<rect width="8.4" height="7.54" fill="#3C3B6E"/>';
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      out += `<circle cx="${1.2 + col * 2}" cy="${1.3 + row * 2.4}" r="0.4" fill="#FFFFFF"/>`;
    }
  }
  return out;
}

/**
 * Flag artwork, viewBox 20x14. Real-world flag colours are the one allowed exception to the
 * "tokens only" rule: they are not theme colours and must not change with light/dark or brand.
 * The 1px neutral border (Figma "Borde") is drawn by the component with --border-default.
 */
const FLAG_ART: Record<FlagCountry, string> = {
  DE: '<rect width="20" height="4.67" fill="#000000"/><rect y="4.67" width="20" height="4.67" fill="#DD0000"/><rect y="9.33" width="20" height="4.67" fill="#FFCE00"/>',
  CN: `<rect width="20" height="14" fill="#DE2910"/><polygon points="${star(3.6, 3.6, 2.2)}" fill="#FFDE00"/><polygon points="${star(7.2, 1.4, 0.7, -70)}" fill="#FFDE00"/><polygon points="${star(8.6, 3.2, 0.7, -50)}" fill="#FFDE00"/><polygon points="${star(8.6, 5.4, 0.7, -20)}" fill="#FFDE00"/><polygon points="${star(7.2, 7, 0.7, 0)}" fill="#FFDE00"/>`,
  JP: '<rect width="20" height="14" fill="#FFFFFF"/><circle cx="10" cy="7" r="4.2" fill="#BC002D"/>',
  SE: '<rect width="20" height="14" fill="#006AA7"/><rect x="5.6" width="2.8" height="14" fill="#FECC00"/><rect y="5.6" width="20" height="2.8" fill="#FECC00"/>',
  US: usStripes(),
  ES: '<rect width="20" height="14" fill="#AA151B"/><rect y="3.5" width="20" height="7" fill="#F1BF00"/>',
  IT: '<rect width="6.67" height="14" fill="#009246"/><rect x="6.67" width="6.67" height="14" fill="#FFFFFF"/><rect x="13.33" width="6.67" height="14" fill="#CE2B37"/>',
  FR: '<rect width="6.67" height="14" fill="#0055A4"/><rect x="6.67" width="6.67" height="14" fill="#FFFFFF"/><rect x="13.33" width="6.67" height="14" fill="#EF4135"/>',
  BR: '<rect width="20" height="14" fill="#009C3B"/><polygon points="10,1.4 18.2,7 10,12.6 1.8,7" fill="#FFDF00"/><circle cx="10" cy="7" r="3.1" fill="#002776"/><path d="M7.1 6.2Q10 5.5 12.9 7.6" stroke="#FFFFFF" stroke-width="0.5" fill="none"/>',
  BO: '<rect width="20" height="4.67" fill="#D52B1E"/><rect y="4.67" width="20" height="4.67" fill="#F9E300"/><rect y="9.33" width="20" height="4.67" fill="#007934"/>',
  AR: '<rect width="20" height="14" fill="#74ACDF"/><rect y="4.67" width="20" height="4.67" fill="#FFFFFF"/><circle cx="10" cy="7" r="1.3" fill="#F6B40E"/>',
  IN: '<rect width="20" height="4.67" fill="#FF9933"/><rect y="4.67" width="20" height="4.67" fill="#FFFFFF"/><rect y="9.33" width="20" height="4.67" fill="#138808"/><circle cx="10" cy="7" r="1.6" fill="none" stroke="#000080" stroke-width="0.4"/><circle cx="10" cy="7" r="0.3" fill="#000080"/>',
  KR: '<rect width="20" height="14" fill="#FFFFFF"/><path d="M6.6 7a3.4 3.4 0 0 1 6.8 0Z" fill="#CD2E3A"/><path d="M13.4 7a3.4 3.4 0 0 1-6.8 0Z" fill="#0047A0"/><g stroke="#000000" stroke-width="0.7"><path d="M2.4 2.2l2 -1.4M3 3.2l2 -1.4"/><path d="M15.6 11.8l2 -1.4M15 10.8l2 -1.4"/><path d="M15.6 2.2l2 1.4M15 1.8l2 1.4"/><path d="M2.4 11.8l2 1.4M3 10.8l2 1.4"/></g>',
  TW: '<rect width="20" height="14" fill="#FE0000"/><rect width="10" height="7" fill="#000095"/><circle cx="5" cy="3.5" r="1.6" fill="#FFFFFF"/><circle cx="5" cy="3.5" r="1.1" fill="#000095"/><circle cx="5" cy="3.5" r="0.75" fill="#FFFFFF"/>',
};

/**
 * Country flag (Figma: Flag Country=DE|CN|JP|SE|US|ES|IT|FR|BR|BO|AR|IN|KR|TW). 20x14, radius 2, 1px border.
 * Scale it with `--rs-flag-border` + width/height on the host (ChipMedia and FieldMedia do).
 */
@Component({
  selector: 'rs-flag',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'img',
    '[attr.aria-label]': 'label() || null',
    '[attr.aria-hidden]': 'label() ? null : "true"',
    '[attr.data-country]': 'country()',
  },
  template: `<svg viewBox="0 0 20 14" preserveAspectRatio="none" aria-hidden="true" [innerHTML]="art()"></svg>`,
  styles: `
    :host {
      position: relative;
      display: inline-block;
      flex: none;
      width: 20px; /* Figma Flag: 20x14 */
      height: 14px;
      overflow: hidden;
      border-radius: 2px; /* Figma: radius 2, no token (radius-xs is 4) */
      vertical-align: middle;
    }
    svg { display: block; width: 100%; height: 100%; }
    :host::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: inherit;
      border: var(--rs-flag-border, var(--stroke-default)) solid var(--border-default);
      pointer-events: none;
    }
  `,
})
export class FlagComponent {
  private readonly sanitizer = inject(DomSanitizer);

  readonly country = input<FlagCountry>('DE');
  /** Accessible name. Empty = decorative. */
  readonly label = input<string>('');

  protected readonly art = computed<SafeHtml>(() => this.sanitizer.bypassSecurityTrustHtml(FLAG_ART[this.country()]));
}
