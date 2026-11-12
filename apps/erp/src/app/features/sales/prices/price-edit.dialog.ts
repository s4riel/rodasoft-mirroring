import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  marginPercent,
  parsePrice,
  PRICE_REASON_MAX,
  priceChangeDelta,
  validatePriceEdit,
  type PriceDetail,
} from '@rodasoft/domain';
import {
  ButtonComponent,
  DataFieldComponent,
  FieldComponent,
  InputDirective,
  InputGroupComponent,
  ModalComponent,
  NoteComponent,
  NumericInputDirective,
  SkeletonComponent,
  TextareaDirective,
  ToastService,
} from '@rodasoft/ui';
import { problemOf } from '../../../core/api-error';
import { formatBs } from '../cash/cash-format';
import { formatMargin, formatPercent, formatSignedAmount } from './price-format';
import { PricesApi } from './prices-api.service';

type LoadState = 'loading' | 'ready' | 'error';

const FIELD_MESSAGES = {
  INVALID_PRICE: 'Ingresa un precio mayor que cero, con hasta 2 decimales.',
  PRICE_UNCHANGED: 'El precio nuevo es igual al actual.',
} as const;

/**
 * VP-11b · Editar precio (HU-VEN-26). One price per product and company: the dialog shows the current one, takes the new one and
 * an optional reason, and previews the change in Bs and percent. The cost and the margins only appear when the API sends them
 * (`inventory.costs.view`). The save carries the price the dialog showed, so an edit over a price someone else just changed is
 * refused and the dialog reloads the current one.
 */
@Component({
  selector: 'rs-price-edit-dialog',
  imports: [
    ButtonComponent,
    DataFieldComponent,
    FieldComponent,
    InputDirective,
    InputGroupComponent,
    ModalComponent,
    NoteComponent,
    NumericInputDirective,
    SkeletonComponent,
    TextareaDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './price-edit.dialog.html',
  styleUrl: './price-edit.dialog.scss',
})
export class PriceEditDialog {
  private readonly api = inject(PricesApi);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = model(false);
  /** The product whose price is edited; the dialog loads it each time it opens. */
  readonly productId = input<string | null>(null);
  readonly saved = output<PriceDetail>();

  protected readonly reasonMax = PRICE_REASON_MAX;
  protected readonly state = signal<LoadState>('loading');
  protected readonly loadError = signal('');
  /** The load was refused (403): retrying cannot help, so the dialog says so instead of offering "Reintentar". */
  protected readonly forbidden = signal(false);
  private readonly priceBox = viewChild<ElementRef<HTMLInputElement>>('priceBox');
  protected readonly product = signal<PriceDetail | null>(null);
  protected readonly price = signal('');
  protected readonly reason = signal('');
  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);
  protected readonly submitError = signal<string | null>(null);
  /** Someone else changed the price while the dialog was open: the dialog now shows the new current price. */
  protected readonly changedElsewhere = signal(false);
  /** Bumped on every load so a slow answer for an earlier product is dropped. */
  private loadToken = 0;

  protected readonly heading = computed(() => {
    const p = this.product();
    return p ? `Editar precio · ${p.manufacturerCode}` : 'Editar precio';
  });
  protected readonly subtitle = computed(() => {
    const p = this.product();
    return p ? `${p.name} · ${p.brand.name} · precio actual ${formatBs(p.salePrice)}` : '';
  });

  private readonly validation = computed(() => {
    const p = this.product();
    return p ? validatePriceEdit(p.salePrice, this.price()) : null;
  });
  /** The typed price as a decimal string, or null while it is not a valid amount. */
  private readonly typed = computed(() => parsePrice(this.price())?.toString() ?? null);

  protected readonly priceMessage = computed(() => {
    const result = this.validation();
    return this.submitted() && result && !result.ok ? FIELD_MESSAGES[result.error] : '';
  });

  /** "Cambio": `+ Bs 10,00 · +4,1 %`, live while typing. */
  protected readonly changeText = computed(() => {
    const p = this.product();
    const typed = this.typed();
    if (!p || typed === null) return '—';
    const delta = priceChangeDelta(p.salePrice, typed);
    const percent = formatPercent(delta.percent);
    return percent ? `${formatSignedAmount(delta.amount)} · ${percent}` : formatSignedAmount(delta.amount);
  });

  /** The cost block is drawn only when the API sent a cost field at all. */
  protected readonly showCosts = computed(() => this.product()?.cost !== undefined);
  protected readonly costText = computed(() => {
    const cost = this.product()?.cost;
    return cost ? formatBs(cost) : '—';
  });
  protected readonly currentMargin = computed(() => formatMargin(this.product()?.marginPercent));
  protected readonly newMargin = computed(() => {
    const typed = this.typed();
    const cost = this.product()?.cost;
    return typed === null || cost === undefined ? '—' : formatMargin(marginPercent(typed, cost));
  });

  constructor() {
    effect(() => {
      const id = this.productId();
      if (this.open() && id) untracked(() => this.load(id));
    });
  }

  protected retry() {
    const id = this.productId();
    if (id) this.load(id);
  }

  private load(id: string) {
    const token = ++this.loadToken;
    this.state.set('loading');
    this.product.set(null);
    this.price.set('');
    this.reason.set('');
    this.submitted.set(false);
    this.saving.set(false);
    this.submitError.set(null);
    this.changedElsewhere.set(false);
    this.forbidden.set(false);
    this.api
      .detail(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          if (token !== this.loadToken) return;
          this.product.set(detail);
          this.state.set('ready');
        },
        error: (err: unknown) => {
          if (token !== this.loadToken) return;
          const problem = problemOf(err);
          this.loadError.set(problem.message);
          this.forbidden.set(problem.status === 403);
          this.state.set('error');
        },
      });
  }

  protected cancel() {
    this.open.set(false);
  }

  protected submit() {
    const p = this.product();
    const result = this.validation();
    if (!p || !result || this.saving()) return;
    this.submitted.set(true);
    if (!result.ok) {
      this.priceBox()?.nativeElement.focus();
      return;
    }
    this.saving.set(true);
    this.submitError.set(null);
    const body = {
      newPrice: result.value.toString(),
      expectedPrice: p.salePrice,
      reason: this.reason().trim() || undefined,
    };
    this.api
      .edit(p.productId, body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.saving.set(false);
          this.toast.success(
            `Precio de ${detail.manufacturerCode} actualizado a ${formatBs(detail.salePrice)}`,
          );
          this.saved.emit(detail);
          this.open.set(false);
        },
        error: (err: unknown) => {
          this.saving.set(false);
          const problem = problemOf(err);
          if (problem.code === 'PRICE_CHANGED') {
            this.reloadAfterConflict(p.productId, problem.message);
            return;
          }
          this.submitError.set(problem.message);
        },
      });
  }

  /** The price moved under the editor: keep what they typed, show the new current price and let them decide again. */
  private reloadAfterConflict(id: string, message: string) {
    const token = ++this.loadToken;
    this.toast.warning(message);
    this.api
      .detail(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          if (token !== this.loadToken) return;
          this.product.set(detail);
          this.changedElsewhere.set(true);
          this.submitted.set(false);
        },
        error: () => {
          if (token !== this.loadToken) return;
          this.submitError.set(message);
        },
      });
  }
}
