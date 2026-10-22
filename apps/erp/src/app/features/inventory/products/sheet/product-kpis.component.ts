import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { ProductDetail, ProductEquivalentsSummary } from '@rodasoft/domain';
import { KpiCardComponent } from '@rodasoft/ui';
import { formatMoney, plural, uniformValue } from './product-sheet.mapper';

/** KPI row shared by the sheet tabs (IN-02a, IN-02b): total stock, price and equivalents. */
@Component({
  selector: 'rs-product-kpis',
  imports: [KpiCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './product-kpis.component.html',
  styleUrl: './product-kpis.component.scss',
})
export class ProductKpisComponent {
  readonly product = input.required<ProductDetail>();
  /** Null while the equivalents load or when they could not be loaded. */
  readonly equivalents = input<ProductEquivalentsSummary | null>(null);
  /** `plain` is the IN-02b wording: label "Precio (Bs)" and the amount without the currency prefix. */
  readonly priceStyle = input<'full' | 'plain'>('full');

  protected readonly stockNote = computed(() => {
    const branches = this.product().stockByBranch;
    const min = uniformValue(branches.map((b) => b.minStock));
    const base = `${branches.length} ${plural(branches.length, 'sucursal', 'sucursales')}`;
    return typeof min === 'number' ? `${base} · mínimo ${min}` : base;
  });

  protected readonly priceLabel = computed(() => (this.priceStyle() === 'plain' ? 'Precio (Bs)' : 'Precio de venta'));
  protected readonly price = computed(() => {
    const amount = formatMoney(this.product().pricing.salePrice);
    return this.priceStyle() === 'plain' ? amount.replace('Bs ', '') : amount;
  });
  protected readonly priceNote = computed(() => {
    const pricing = this.product().pricing;
    if (pricing.cost === undefined) return '';
    const margin = pricing.marginPercent ? pricing.marginPercent.replace('.', ',') : null;
    return `Costo ${formatMoney(pricing.cost)}${margin ? ` · margen ${margin} %` : ''}`;
  });

  protected readonly equivalentsValue = computed(() => {
    const s = this.equivalents();
    if (!s || s.brandCount === 0) return '–';
    return `${s.brandCount} ${plural(s.brandCount, 'marca', 'marcas')}`;
  });
  protected readonly equivalentsNote = computed(() => {
    const s = this.equivalents();
    if (!s) return '';
    if (s.brandCount === 0 && s.exact + s.withDifferences + s.incompatible === 0) return 'Sin equivalentes registrados';
    const parts = [
      `${s.exact} ${plural(s.exact, 'exacta', 'exactas')}`,
      `${s.withDifferences} con diferencias`,
      ...(s.incompatible ? [`${s.incompatible} ${plural(s.incompatible, 'distinta', 'distintas')}`] : []),
    ];
    return parts.join(' · ');
  });
}
