import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ILLUSTRATIONS, IllustrationName } from './illustrations';

/**
 * Spot illustration, 240x180 (Figma: Illustration/<Name>). Colours come from CSS variables, so it follows
 * the theme and the brand. Decorative by default; pass `label` to expose it.
 */
@Component({
  selector: 'rs-illustration',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.role]': 'label() ? "img" : null',
    '[attr.aria-label]': 'label() || null',
    '[attr.aria-hidden]': 'label() ? null : "true"',
    '[attr.data-name]': 'name()',
  },
  template: `<svg viewBox="0 0 240 180" width="240" height="180" focusable="false" [innerHTML]="art()"></svg>`,
  styles: `
    :host { display: inline-block; width: 240px; height: 180px; line-height: 0; }
    svg { display: block; width: 100%; height: 100%; }
  `,
})
export class IllustrationComponent {
  private readonly sanitizer = inject(DomSanitizer);

  readonly name = input.required<IllustrationName>();
  readonly label = input<string>('');

  // Artwork is a static, trusted constant of this library (never user input).
  protected readonly art = computed<SafeHtml>(() => this.sanitizer.bypassSecurityTrustHtml(ILLUSTRATIONS[this.name()]));
}
