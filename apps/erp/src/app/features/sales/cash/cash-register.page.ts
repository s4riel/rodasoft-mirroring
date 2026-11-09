import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { Decimal, type CashShiftDetail, type ManualCashMovementType } from '@rodasoft/domain';
import {
  ButtonComponent,
  CanDirective,
  DataFieldComponent,
  DocTableCellDirective,
  DocTableComponent,
  type DocTableColumn,
  type DocTableRow,
  EmptyStateIllustratedComponent,
  KpiCardComponent,
  NoteComponent,
  PageHeaderComponent,
  RowActionComponent,
  type RowMenuItem,
  SkeletonComponent,
  ToastOutletComponent,
  ToastService,
} from '@rodasoft/ui';
import { problemOf } from '../../../core/api-error';
import { ContextStore } from '../../../core/context.store';
import { CashApi } from './cash-api.service';
import { CashMovementDialog } from './cash-movement.dialog';
import {
  formatBs,
  formatOpenedAt,
  formatTime,
  METHOD_LABELS,
  movementConceptLabel,
  movementStatusPill,
  MOVEMENT_TYPE_LABELS,
  signedAmount,
} from './cash-format';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

const MOVEMENT_COLUMNS: DocTableColumn[] = [
  { key: 'time', label: 'Hora', width: '6rem' },
  { key: 'type', label: 'Tipo', width: '9rem' },
  { key: 'concept', label: 'Concepto' },
  { key: 'by', label: 'Registró' },
  { key: 'state', label: 'Estado', type: 'status', width: '9rem' },
  { key: 'amount', label: 'Monto', type: 'number' },
  { key: 'actions', label: '', type: 'custom', width: '4rem' },
];

const METHOD_COLUMNS: DocTableColumn[] = [
  { key: 'method', label: 'Forma de pago' },
  { key: 'count', label: 'Ventas', type: 'number' },
  { key: 'amount', label: 'Monto', type: 'number' },
];

/**
 * VP-22 · Caja. The cashier's open shift: the cash the register should hold, the sales per payment method, the cash movements
 * with their state and how the expected cash is calculated. From here the cashier registers an income or an expense (VP-22b)
 * and goes to close the register (VP-06). Without a shift it goes to the opening form (VP-05).
 */
@Component({
  selector: 'rs-cash-register-page',
  imports: [
    ButtonComponent,
    CanDirective,
    CashMovementDialog,
    DataFieldComponent,
    DocTableCellDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    KpiCardComponent,
    NoteComponent,
    PageHeaderComponent,
    RouterLink,
    RowActionComponent,
    SkeletonComponent,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cash-register.page.html',
  styleUrl: './cash-register.page.scss',
})
export class CashRegisterPage implements OnInit {
  private readonly api = inject(CashApi);
  private readonly ctx = inject(ContextStore);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly state = signal<LoadState>('loading');
  protected readonly shift = signal<CashShiftDetail | null>(null);
  protected readonly dialogOpen = signal(false);
  protected readonly dialogType = signal<ManualCashMovementType>('EXPENSE');
  protected readonly actionError = signal<string | null>(null);
  protected readonly breadcrumbs = [{ label: 'Inicio', link: '/' }, { label: 'Ventas y POS', link: '/sales' }, { label: 'Caja' }];
  protected readonly movementColumns = MOVEMENT_COLUMNS;
  protected readonly methodColumns = METHOD_COLUMNS;
  protected readonly skeletonRows = Array.from({ length: 4 }, (_, i) => i);
  protected readonly formatBs = formatBs;

  protected readonly title = computed(() => {
    const s = this.shift();
    return s ? `${s.register.name} · turno abierto` : 'Caja';
  });
  protected readonly description = computed(() => {
    const s = this.shift();
    if (!s) return '';
    return `Abierta ${formatOpenedAt(s.openedAt)} por ${s.openedBy.name} con ${formatBs(s.openingFloat)} · ${s.branch.name}`;
  });
  protected readonly salesNote = computed(() => {
    const count = this.shift()?.sales.count ?? 0;
    return `${count} ${count === 1 ? 'venta' : 'ventas'}`;
  });
  protected readonly pendingText = computed(() => {
    const n = this.shift()?.pendingExpenses ?? 0;
    return n === 1 ? 'Tienes 1 egreso pendiente de aprobación de Gerencia.' : `Tienes ${n} egresos pendientes de aprobación de Gerencia.`;
  });
  protected readonly refunds = computed(() => this.shift()?.cash.refunds ?? '0.00');
  protected readonly hasRefunds = computed(() => !Decimal.of(this.refunds()).isZero());

  protected readonly movementRows = computed<DocTableRow[]>(() => {
    const s = this.shift();
    if (!s) return [];
    const opening: DocTableRow = {
      id: 'opening',
      label: 'Apertura de caja',
      cells: {
        time: formatTime(s.openedAt),
        type: 'Apertura',
        concept: 'Efectivo inicial',
        by: s.openedBy.name,
        state: null,
        amount: signedAmount('INCOME', s.openingFloat),
        actions: null,
      },
    };
    const rows = s.movements.map<DocTableRow>((m) => {
      const pill = movementStatusPill(m.status);
      return {
        id: m.id,
        label: `${MOVEMENT_TYPE_LABELS[m.type]} ${movementConceptLabel(m)}`,
        cells: {
          time: formatTime(m.createdAt),
          type: MOVEMENT_TYPE_LABELS[m.type],
          concept: movementConceptLabel(m),
          by: m.by.name,
          state: pill ? { label: pill.label, status: pill.status } : null,
          amount: signedAmount(m.type, m.amount),
          actions: null,
        },
      };
    });
    return [opening, ...rows];
  });

  protected readonly methodRows = computed<DocTableRow[]>(() =>
    (this.shift()?.methods ?? []).map((m) => ({
      id: m.method,
      cells: { method: METHOD_LABELS[m.method], count: m.count, amount: formatBs(m.amount) },
    })),
  );
  protected readonly methodTotals = computed(() => {
    const s = this.shift();
    return s ? { method: 'Total', count: s.sales.count, amount: formatBs(s.sales.total) } : null;
  });

  ngOnInit() {
    if (!this.ctx.can('sales.cash-register.open')) {
      this.state.set('forbidden');
      return;
    }
    this.load();
  }

  protected load() {
    this.state.set('loading');
    this.api
      .current()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ shift }) => {
          if (!shift) {
            void this.router.navigate(['/sales/cash-register/open'], { replaceUrl: true });
            return;
          }
          this.fetch(shift.id, true);
        },
        error: (err: unknown) => this.state.set(problemOf(err).status === 403 ? 'forbidden' : 'error'),
      });
  }

  /** Reads the shift; `first` shows the skeleton and the error state, a later read just refreshes the numbers. */
  private fetch(shiftId: string, first: boolean) {
    this.api
      .shift(shiftId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.shift.set(detail);
          this.state.set('ready');
        },
        error: (err: unknown) => {
          if (first) this.state.set(problemOf(err).status === 403 ? 'forbidden' : 'error');
          else this.actionError.set(problemOf(err).message);
        },
      });
  }

  protected openDialog(type: ManualCashMovementType) {
    this.actionError.set(null);
    this.dialogType.set(type);
    this.dialogOpen.set(true);
  }

  /** A registered movement changes the expected cash and the table: read the shift again. */
  protected onRegistered() {
    const s = this.shift();
    if (s) this.fetch(s.id, false);
  }

  /** The row menu of a movement: its receipt, taking back a pending expense (the requester) and reviewing it (who approves). */
  protected menuOf(rowId: string): RowMenuItem[] {
    const movement = this.shift()?.movements.find((m) => m.id === rowId);
    if (!movement) return [];
    const items: RowMenuItem[] = [];
    if (movement.hasReceipt) items.push({ key: 'receipt', label: 'Ver comprobante', icon: 'document' });
    if (movement.status === 'PENDING' && movement.by.id === this.ctx.context()?.user.id) {
      items.push({ key: 'withdraw', label: 'Retirar solicitud', icon: 'close', danger: true });
    }
    if (movement.status === 'PENDING' && this.ctx.can('sales.cash-expenses.approve')) {
      items.push({ key: 'review', label: 'Revisar', icon: 'eye' });
    }
    return items;
  }

  protected onMenu(rowId: string, key: string) {
    this.actionError.set(null);
    if (key === 'receipt') this.openReceipt(rowId);
    else if (key === 'withdraw') this.withdraw(rowId);
    else if (key === 'review') void this.router.navigate(['/sales/cash-register/movements', rowId]);
  }

  private openReceipt(movementId: string) {
    this.api
      .receipt(movementId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => window.open(URL.createObjectURL(blob), '_blank', 'noopener'),
        error: (err: unknown) => this.actionError.set(problemOf(err).message),
      });
  }

  private withdraw(movementId: string) {
    this.api
      .withdraw(movementId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Solicitud retirada');
          this.onRegistered();
        },
        error: (err: unknown) => {
          this.actionError.set(problemOf(err).message);
          // somebody decided it in between: show what it is now
          this.onRegistered();
        },
      });
  }
}
