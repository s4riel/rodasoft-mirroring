import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IconDef, IconName, resolveIcon } from './icons';

@Component({
  selector: 'rs-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'rs-icon', '[style.width.px]': 'size()', '[style.height.px]': 'size()', 'aria-hidden': 'true' },
  template: `
    <svg viewBox="0 0 24 24" [attr.width]="size()" [attr.height]="size()" fill="none" stroke="currentColor"
      [attr.stroke-width]="stroke()" [attr.stroke-linecap]="def().cap ?? 'round'" [attr.stroke-linejoin]="def().join ?? 'round'"
      [style.transform]="rotation() ? 'rotate(' + rotation() + 'deg)' : null">
      @for (d of def().d; track $index) {
        <path [attr.d]="d" />
      }
      @for (c of def().circles ?? []; track $index) {
        <circle [attr.cx]="c[0]" [attr.cy]="c[1]" [attr.r]="c[2]" />
      }
      @for (f of def().fills ?? []; track $index) {
        <path [attr.d]="f" fill="currentColor" stroke="none" />
      }
    </svg>
  `,
  styles: `
    :host { display: inline-flex; flex: none; }
    svg { display: block; }
  `,
})
export class IconComponent {
  readonly name = input.required<IconName>();
  readonly size = input<16 | 20 | 24>(20);
  /** Stroke width; the default follows the `--stroke-icon` token (1.8). */
  readonly stroke = input(1.8);
  private readonly resolved = computed(() => resolveIcon(this.name()));
  protected readonly def = computed<IconDef>(() => this.resolved().def);
  protected readonly rotation = computed(() => this.resolved().rotate);
}
