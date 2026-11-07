import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, Renderer2, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { buildReceiptLines, Decimal, formatReceiptDate, type SaleReceipt } from '@rodasoft/domain';
import { ButtonComponent, EmptyStateIllustratedComponent, ReceiptComponent, SkeletonComponent, type ReceiptItem, type ReceiptRow } from '@rodasoft/ui';
import { problemOf } from '../../../core/api-error';
import { documentText } from '../customers/customer-format';
import { SalesHistoryApi } from '../history/sales-history-api.service';
import { PosApi } from '../pos/pos-api.service';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

const money = (value: string) => Decimal.of(value).format();

/** `@page` of each paper: the roll has no margin and a height that follows the content; the letter page keeps a margin. */
const PAGE_RULES = {
  TICKET_80MM: '@page { size: 80mm auto; margin: 0; }',
  LETTER: '@page { size: letter; margin: 12mm; }',
} as const;

/**
 * The printable receipt of a completed sale (HU-VEN-11), opened from "Imprimir ticket" in its own tab. It loads the receipt,
 * draws it with `rs-receipt` on the company's paper (`sales.receiptFormat`, 80 mm by default) and opens the print dialog.
 * Outside the ERP shell: only the receipt is on the page, and the button is hidden when printing.
 */
@Component({
  selector: 'rs-receipt-print-page',
  imports: [ButtonComponent, EmptyStateIllustratedComponent, ReceiptComponent, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './receipt-print.page.html',
  styleUrl: './receipt-print.page.scss',
})
export class ReceiptPrintPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(PosApi);
  private readonly history = inject(SalesHistoryApi);
  private readonly document = inject(DOCUMENT);
  private readonly renderer = inject(Renderer2);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly state = signal<LoadState>('loading');
  protected readonly receipt = signal<SaleReceipt | null>(null);
  protected readonly errorText = signal('');
  /** ISO instant of the reprint (`?reprint=1`); the ticket says so in its header. */
  private readonly reprintedAt = signal<string | null>(null);

  protected readonly paper = computed(() => (this.receipt()?.format === 'LETTER' ? 'letter' : 'ticket-80mm'));

  protected readonly headerLines = computed(() => {
    const receipt = this.receipt();
    if (!receipt) return [];
    const lines = [receipt.company.legalName, `NIT ${receipt.company.nit}`, receipt.branch.name];
    const reprintedAt = this.reprintedAt();
    return reprintedAt ? [...lines, `REIMPRESIÓN · ${formatReceiptDate(reprintedAt)}`] : lines;
  });

  protected readonly metaRows = computed<ReceiptRow[]>(() => {
    const r = this.receipt();
    if (!r) return [];
    return [
      { label: 'Comprobante', value: r.number },
      { label: 'Fecha', value: formatReceiptDate(r.createdAt) },
      { label: 'Cajero', value: r.cashier.name },
      { label: 'Cliente', value: r.customer.name },
      { label: 'Documento', value: documentText(r.customer) },
    ];
  });

  protected readonly items = computed<ReceiptItem[]>(() => buildReceiptLines(this.receipt()?.lines ?? []));

  protected readonly totalRows = computed<ReceiptRow[]>(() => {
    const r = this.receipt();
    if (!r) return [];
    const rows: ReceiptRow[] = [{ label: 'Subtotal', value: money(r.subtotal) }];
    if (!Decimal.of(r.discountAmount).isZero()) rows.push({ label: 'Descuento', value: `−${money(r.discountAmount)}` });
    if (!Decimal.of(r.roundingAmount).isZero()) rows.push({ label: 'Redondeo', value: money(r.roundingAmount) });
    rows.push({ label: 'Total', value: money(r.total), strong: true });
    // what the customer handed over: the part the sale kept plus the change given back
    const cash = r.payments.filter((p) => p.method === 'CASH');
    if (cash.length > 0) {
      const kept = cash.reduce((acc, p) => acc.add(Decimal.of(p.amount)), Decimal.zero());
      const change = cash.reduce((acc, p) => acc.add(Decimal.of(p.change)), Decimal.zero());
      rows.push({ label: 'Efectivo recibido', value: kept.add(change).format() }, { label: 'Cambio', value: change.format() });
    }
    return rows;
  });

  protected readonly footerLines = computed(() => {
    const receipt = this.receipt();
    if (!receipt) return [];
    return [receipt.invoiceStatus === 'PENDING' ? 'Factura pendiente de emisión' : 'Factura emitida', 'Gracias por su compra.'];
  });

  ngOnInit() {
    this.load();
  }

  protected load() {
    this.state.set('loading');
    const saleId = this.route.snapshot.paramMap.get('saleId') ?? '';
    this.api
      .receipt(saleId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (receipt) => {
          if (this.route.snapshot.queryParamMap.get('reprint') === '1') this.recordReprint(receipt);
          else this.show(receipt);
        },
        error: (err: unknown) => this.fail(err),
      });
  }

  /** A reprint is recorded first: the ticket carries the instant the server kept, and the sale's history shows it. */
  private recordReprint(receipt: SaleReceipt) {
    this.history
      .reprint(receipt.saleId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ printedAt }) => {
          this.reprintedAt.set(printedAt);
          this.show(receipt);
        },
        error: (err: unknown) => this.fail(err),
      });
  }

  private show(receipt: SaleReceipt) {
    this.receipt.set(receipt);
    this.state.set('ready');
    this.addPageRule(receipt);
    // the receipt is drawn before the print dialog opens
    setTimeout(() => this.print());
  }

  private fail(err: unknown) {
    const problem = problemOf(err);
    this.errorText.set(problem.message);
    this.state.set(problem.status === 403 ? 'forbidden' : 'error');
  }

  protected print() {
    this.document.defaultView?.print();
  }

  /** The paper size is a global `@page` rule: it is added while the page lives and removed with it. */
  private addPageRule(receipt: SaleReceipt) {
    const style = this.renderer.createElement('style') as HTMLStyleElement;
    style.textContent = PAGE_RULES[receipt.format];
    this.renderer.appendChild(this.document.head, style);
    this.destroyRef.onDestroy(() => this.renderer.removeChild(this.document.head, style));
  }
}
