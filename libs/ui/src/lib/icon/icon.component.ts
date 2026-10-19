import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IconDef, ICONS, IconName } from './icons';

@Component({
  selector: 'rs-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'rs-icon', '[style.width.px]': 'size()', '[style.height.px]': 'size()', 'aria-hidden': 'true' },
  template: `
    <svg viewBox="0 0 24 24" [attr.width]="size()" [attr.height]="size()" fill="none" stroke="currentColor"
      [attr.stroke-width]="stroke()" stroke-linecap="round" stroke-linejoin="round">
      @for (d of def().d; track $index) {
        <path [attr.d]="d" />
      }
      @for (c of def().circles ?? []; track $index) {
        <circle [attr.cx]="c[0]" [attr.cy]="c[1]" [attr.r]="c[2]" />
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
  readonly stroke = input(1.8);
  protected readonly def = computed<IconDef>(() => ICONS[this.name()]);
}
