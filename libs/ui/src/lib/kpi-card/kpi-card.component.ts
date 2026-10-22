import { booleanAttribute, ChangeDetectionStrategy, Component, input } from '@angular/core';

export type KpiTrend = 'positive' | 'negative' | 'neutral';

/**
 * Figma: KpiCard Trend=Positive|Negative|Neutral, State=Default|Hover|Focus|Disabled. Title, mono value and a trend
 * line (period comparison). The trend only tints the line: the text must say the change ("+12% vs. mes anterior").
 * Hover and Focus are CSS (`:hover`, `:focus-visible` when the host is focusable); Disabled keeps the reading.
 *   <rs-kpi-card label="Stock total" value="60" trend="positive" note="+12% vs. mes anterior" />
 */
@Component({
  selector: 'rs-kpi-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-trend]': 'trend()', '[attr.aria-disabled]': 'disabled() || null' },
  templateUrl: './kpi-card.component.html',
  styleUrl: './kpi-card.component.scss',
})
export class KpiCardComponent {
  /** Figma Title. */
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  /** Trend line text. */
  readonly note = input('');
  readonly trend = input<KpiTrend>('neutral');
  readonly disabled = input(false, { transform: booleanAttribute });
}
