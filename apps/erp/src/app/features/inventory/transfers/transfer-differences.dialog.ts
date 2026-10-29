import { ChangeDetectionStrategy, Component, computed, effect, input, model, output, signal } from '@angular/core';
import {
  ButtonComponent,
  DocTableColumn,
  DocTableComponent,
  DocTableRow,
  DocTableStatus,
  FieldComponent,
  InputDirective,
  ModalComponent,
  NoteComponent,
  NumericInputDirective,
  SelectComponent,
  SelectOption,
} from '@rodasoft/ui';
import { formatMoney } from '../products/sheet/product-sheet.mapper';
import { canHaveSurplus, differencesOf, type DifferenceRow, type ReceiptLineState } from './transfer-receipt';

const PILLS: Record<DifferenceRow['kind'], DocTableStatus> = {
  SHORTAGE: { label: 'Faltante', status: 'danger', icon: 'alert' },
  SURPLUS: { label: 'Sobrante', status: 'warning', icon: 'alert' },
};

/**
 * IN-07 · Differences of the receipt, shown before it is closed: the shortage of each product that ends short and the
 * surplus the user types for the ones received in full. Confirming emits the surplus; the screen closes the receipt.
 */
@Component({
  selector: 'rs-transfer-differences-dialog',
  imports: [ButtonComponent, DocTableComponent, FieldComponent, InputDirective, ModalComponent, NoteComponent, NumericInputDirective, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './transfer-differences.dialog.html',
  styleUrl: './transfer-differences.dialog.scss',
})
export class TransferDifferencesDialog {
  readonly open = model(false);
  /** The lines with the final count of the session about to be closed. */
  readonly lines = input.required<readonly ReceiptLineState[]>();
  readonly busy = input(false);
  readonly error = input<string | null>(null);
  /** The surplus typed, by product; the screen sends it with the close. */
  readonly confirmed = output<Record<string, number>>();

  protected readonly surplus = signal<Record<string, number>>({});
  protected readonly surplusProductId = signal<string | null>(null);

  protected readonly candidates = computed(() => this.lines().filter(canHaveSurplus));
  protected readonly candidateOptions = computed<SelectOption[]>(() => this.candidates().map((l) => ({ value: l.productId, label: `${l.code} · ${l.name}` })));
  protected readonly showValue = computed(() => this.lines().some((l) => l.unitCost !== null));

  protected readonly columns = computed<DocTableColumn[]>(() => [
    { key: 'code', label: 'Código', type: 'code' },
    { key: 'product', label: 'Producto', type: 'text' },
    { key: 'kind', label: 'Diferencia', type: 'status', width: '9rem' },
    { key: 'quantity', label: 'Cantidad', type: 'number' },
    ...(this.showValue() ? [{ key: 'value', label: 'Valor (Bs)', type: 'number' } as DocTableColumn] : []),
  ]);
  protected readonly differences = computed(() => differencesOf(this.lines(), this.surplus()));
  protected readonly rows = computed<DocTableRow[]>(() =>
    this.differences().map((d) => ({
      id: d.productId,
      label: d.code,
      cells: { code: d.code, product: d.name, kind: PILLS[d.kind], quantity: d.quantity > 0 ? `+${d.quantity}` : `${d.quantity}`, value: formatMoney(d.value) },
    })),
  );
  protected readonly surplusOfSelected = computed(() => {
    const id = this.surplusProductId();
    return id ? (this.surplus()[id] ?? 0) : 0;
  });

  constructor() {
    // every time the dialog opens, the surplus starts from scratch
    effect(() => {
      if (this.open()) {
        this.surplus.set({});
        this.surplusProductId.set(null);
      }
    });
  }

  protected selectProduct(value: unknown) {
    this.surplusProductId.set(value ? String(value) : null);
  }

  protected onSurplus(event: Event) {
    const id = this.surplusProductId();
    if (!id) return;
    const raw = (event.target as HTMLInputElement).value.trim();
    const quantity = raw === '' ? 0 : Number(raw);
    this.surplus.update((current) => {
      const next = { ...current };
      if (Number.isInteger(quantity) && quantity > 0) next[id] = quantity;
      else delete next[id];
      return next;
    });
  }

  protected confirm() {
    this.confirmed.emit(this.surplus());
  }
}
