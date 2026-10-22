import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IconDef, IconName, resolveIcon } from './icons';

@Component({
  selector: 'rs-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'rs-icon',
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
    'aria-hidden': 'true',
  },
  templateUrl: './icon.component.html',
  styleUrl: './icon.component.scss',
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
