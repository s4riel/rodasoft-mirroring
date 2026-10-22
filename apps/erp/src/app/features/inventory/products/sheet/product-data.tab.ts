import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { fieldIconOf, SPEC_STEP_DIMENSIONS } from '@rodasoft/domain';
import {
  ChipMediaComponent,
  DataFieldComponent,
  FlagComponent,
  IconComponent,
  IconName,
  StatusPillComponent,
  StockFlagComponent,
} from '@rodasoft/ui';
import { ContextStore } from '../../../../core/context.store';
import { flagOf, thumbIconOf } from '../product-list.mapper';
import { equivalencePill } from './equivalents/equivalence-pill';
import { ProductKpisComponent } from './product-kpis.component';
import {
  fileNameOf,
  plural,
  formatDate,
  formatKilograms,
  formatMillimeters,
  formatMoney,
  formatPercent,
  formatUnit,
  SpecField,
  toSpecField,
  uniformValue,
} from './product-sheet.mapper';
import { ProductSheetStore } from './product-sheet.store';

/** IN-02a · "Datos" tab of the product sheet. Reads the product the parent page loaded. */
@Component({
  selector: 'rs-product-data-tab',
  imports: [
    ChipMediaComponent,
    DataFieldComponent,
    FlagComponent,
    IconComponent,
    ProductKpisComponent,
    RouterLink,
    StatusPillComponent,
    StockFlagComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './product-data.tab.html',
  styleUrl: './product-data.tab.scss',
})
export class ProductDataTab {
  private readonly ctx = inject(ContextStore);
  private readonly store = inject(ProductSheetStore);
  protected readonly product = this.store.product;
  protected readonly equivalents = this.store.equivalents;
  protected readonly equivalentsFailed = this.store.equivalentsFailed;
  /** The first equivalents with their short pill, for the Equivalencias card. */
  protected readonly equivalentItems = computed(() =>
    (this.equivalents()?.items ?? []).map((item) => ({ item, pill: equivalencePill(item, 'short') })),
  );

  protected readonly flag = computed(() => flagOf(this.product()?.country?.code));
  protected readonly thumbIcon = computed<IconName>(() => thumbIconOf(this.product()?.category.icon ?? ''));
  protected readonly sectors = computed(() =>
    (this.product()?.extra.sectors ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

  // ── stock per branch (compact list of the side column) ──
  protected readonly branches = computed(() =>
    (this.product()?.stockByBranch ?? []).map((b) => ({
      id: b.branchId,
      name: b.branchName,
      quantity: b.quantity,
      availability: b.availability,
      current: b.branchId === this.ctx.branchId(),
    })),
  );
  private readonly minStock = computed(() => uniformValue((this.product()?.stockByBranch ?? []).map((b) => b.minStock)));
  private readonly maxStock = computed(() => uniformValue((this.product()?.stockByBranch ?? []).map((b) => b.maxStock)));
  private readonly location = computed(() => uniformValue((this.product()?.stockByBranch ?? []).map((b) => b.location)));

  /** "Mínimo 6 · máximo 60" when the branches share the same limits. */
  protected readonly stockLimits = computed(() => {
    const min = this.minStock();
    const max = this.maxStock();
    const parts = [
      typeof min === 'number' ? `Mínimo ${min}` : null,
      typeof max === 'number' ? `máximo ${max}` : null,
    ].filter(Boolean);
    return parts.join(' · ');
  });
  protected readonly stockMinLabel = computed(() => this.limitLabel(this.minStock()));
  protected readonly stockMaxLabel = computed(() => this.limitLabel(this.maxStock()));
  protected readonly locationLabel = computed(() => this.limitLabel(this.location()));

  // ── price ──
  protected readonly hasCost = computed(() => this.product()?.pricing.cost !== undefined);
  protected readonly salePrice = computed(() => formatMoney(this.product()?.pricing.salePrice));
  protected readonly cost = computed(() => formatMoney(this.product()?.pricing.cost));
  protected readonly margin = computed(() => formatPercent(this.product()?.pricing.marginPercent));
  protected readonly unit = computed(() => formatUnit(this.product()?.unit ?? ''));

  // ── dimensions and specifications ──
  protected readonly dimensions = computed(() => this.product()?.dimensions ?? null);
  protected readonly dimensionFields = computed(() => {
    const d = this.dimensions();
    if (!d) return [];
    return [
      { label: 'Interior d', icon: 'diameter' as IconName, value: formatMillimeters(d.innerDiameter), mono: true },
      { label: 'Exterior D', icon: 'diameter' as IconName, value: formatMillimeters(d.outerDiameter), mono: true },
      { label: 'Ancho B', icon: 'ruler' as IconName, value: formatMillimeters(d.width), mono: true },
      { label: 'Peso', icon: 'package' as IconName, value: formatKilograms(d.weight), mono: false },
    ];
  });
  /** Fields of the creation step "Dimensions" (series, minimum radius, bore type…), after d, D, B and weight. */
  protected readonly dimensionSpecs = computed<SpecField[]>(() =>
    (this.product()?.specs ?? []).filter((s) => s.step === SPEC_STEP_DIMENSIONS).map(toSpecField),
  );
  protected readonly specFields = computed<SpecField[]>(() =>
    (this.product()?.specs ?? []).filter((s) => s.step !== SPEC_STEP_DIMENSIONS).map(toSpecField),
  );

  // ── media and record ──
  protected readonly datasheetName = computed(() => fileNameOf(this.product()?.datasheetUrl ?? ''));
  protected readonly referenceLabel = computed(() => {
    const n = this.equivalents()?.total ?? 0;
    return `${n} ${plural(n, 'referencia', 'referencias')} de otras marcas`;
  });

  protected readonly createdAt = computed(() => formatDate(this.product()?.createdAt ?? ''));
  protected readonly updatedAt = computed(() => formatDate(this.product()?.updatedAt ?? ''));
  protected readonly createdLine = computed(() => this.recordLine(this.product()?.createdBy?.name, this.createdAt()));
  protected readonly updatedLine = computed(() =>
    this.recordLine(this.product()?.updatedBy?.name ?? this.product()?.createdBy?.name, this.updatedAt()),
  );

  protected readonly icons = {
    code: fieldIconOf({ type: 'CODE' }),
    sku: fieldIconOf({ type: 'SKU' }),
    money: fieldIconOf({ type: 'MONEY' }),
    percent: fieldIconOf({ type: 'PERCENT' }),
    date: fieldIconOf({ type: 'DATE' }),
    location: fieldIconOf({ type: 'LOCATION' }),
    count: fieldIconOf({ type: 'NUMBER' }),
    text: fieldIconOf({ type: 'TEXT' }),
  } satisfies Record<string, IconName>;

  /** The value shared by every branch, "Según sucursal" when they differ and an empty marker when none is set. */
  private limitLabel(value: string | number | null | 'mixed'): string {
    return value === 'mixed' ? 'Según sucursal' : value === null ? '' : String(value);
  }

  private recordLine(name: string | undefined, date: string): string {
    return name ? `${name} · ${date}` : date;
  }
}
