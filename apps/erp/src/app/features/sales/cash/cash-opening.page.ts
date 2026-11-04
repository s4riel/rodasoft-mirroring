import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { validateOpeningFloat, type CashRegisterOption, type CurrentCashShift, type OpeningFloatError } from '@rodasoft/domain';
import {
  ButtonComponent,
  EmptyStateIllustratedComponent,
  FieldComponent,
  IconComponent,
  InputDirective,
  InputGroupComponent,
  NoteComponent,
  NumericInputDirective,
  PageHeaderComponent,
  SelectComponent,
  SelectOption,
  SkeletonComponent,
  ToastOutletComponent,
  ToastService,
} from '@rodasoft/ui';
import { forkJoin } from 'rxjs';
import { problemOf } from '../../../core/api-error';
import { ContextStore } from '../../../core/context.store';
import { CashApi } from './cash-api.service';
import { formatBs, formatDifference, formatRelativeDateTime, registerPlace } from './cash-format';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

/** Value of the only option of the locked Cajero select. */
const ME = 'me';

/** Spanish message for each reason the opening float is refused (VP-05). */
const FLOAT_MESSAGES: Record<OpeningFloatError, string> = {
  REQUIRED: 'Ingresa el efectivo inicial.',
  INVALID_FORMAT: 'Ingresa un monto válido, por ejemplo 500,00.',
  NEGATIVE: 'El efectivo inicial no puede ser negativo.',
  TOO_MANY_DECIMALS: 'Usa como máximo 2 decimales.',
  TOO_LARGE: 'El monto es demasiado grande.',
};

/**
 * VP-05 · Apertura de caja. The cashier picks a register of the branch in the ContextBar (the ones already open are
 * disabled), sees who the shift is registered to (always the logged-in user) and types the starting float. On success it
 * goes to the POS.
 */
@Component({
  selector: 'rs-cash-opening-page',
  imports: [
    ButtonComponent,
    EmptyStateIllustratedComponent,
    FieldComponent,
    IconComponent,
    InputDirective,
    InputGroupComponent,
    NoteComponent,
    NumericInputDirective,
    PageHeaderComponent,
    ReactiveFormsModule,
    RouterLink,
    SelectComponent,
    SkeletonComponent,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cash-opening.page.html',
  styleUrl: './cash-opening.page.scss',
})
export class CashOpeningPage implements OnInit {
  private readonly api = inject(CashApi);
  private readonly ctx = inject(ContextStore);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly form = new FormGroup({
    registerId: new FormControl<string | null>(null),
    // the shift is always opened by the logged-in user: a locked select showing their name
    cashier: new FormControl({ value: ME, disabled: true }, { nonNullable: true }),
    openingFloat: new FormControl('', { nonNullable: true }),
  });

  protected readonly state = signal<LoadState>('loading');
  protected readonly registers = signal<CashRegisterOption[]>([]);
  /** The user's own shift when they already have one: opening a second one is refused. */
  protected readonly ownShift = signal<CurrentCashShift | null>(null);
  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);
  protected readonly submitError = signal<string | null>(null);
  // the form is not a signal source: this mirrors the values the template reads
  private readonly registerId = signal<string | null>(null);
  private readonly floatText = signal('');
  private readonly floatTouched = signal(false);

  protected readonly breadcrumbs = [
    { label: 'Inicio', link: '/' },
    { label: 'Ventas y POS', link: '/sales' },
    { label: 'Apertura de caja' },
  ];

  /** Registers of the branch chosen in the ContextBar (all of them when it says "Todas"). */
  protected readonly visibleRegisters = computed(() => {
    const branch = this.ctx.currentBranch();
    const all = this.registers();
    return branch ? all.filter((r) => r.branch.id === branch.id) : all;
  });
  protected readonly registerOptions = computed<SelectOption[]>(() =>
    this.visibleRegisters().map((r) => ({
      value: r.id,
      label: r.openShift ? `${r.name} · en uso por ${r.openShift.openedByName ?? 'otro usuario'}` : r.name,
      disabled: r.openShift !== null,
    })),
  );
  protected readonly selected = computed(() => this.visibleRegisters().find((r) => r.id === this.registerId()) ?? null);

  protected readonly description = computed(() => {
    const r = this.selected() ?? (this.visibleRegisters().length === 1 ? this.visibleRegisters()[0] : null);
    return r ? `${registerPlace(r)} · cuenta el efectivo antes de empezar a vender` : 'Cuenta el efectivo antes de empezar a vender';
  });

  protected readonly cashierOptions = computed<SelectOption[]>(() => [{ value: ME, label: this.ctx.context()?.user.name ?? '' }]);

  /** Second line of the "Último cierre de esta caja" block (Figma VP-05), for the selected register. */
  protected readonly lastCloseText = computed(() => {
    const register = this.selected();
    if (!register) return null;
    const last = register.lastClose;
    if (!last) return 'Sin cierres anteriores';
    return [
      formatRelativeDateTime(last.closedAt),
      last.closedByName,
      formatDifference(last.differenceAmount),
      last.closingFloat !== null ? `${formatBs(last.closingFloat)} dejados en caja` : null,
    ]
      .filter((part): part is string => part !== null)
      .join(' · ');
  });

  protected readonly registerMessage = computed(() =>
    this.submitted() && !this.registerId() ? 'Elige la caja que vas a abrir.' : null,
  );
  protected readonly floatMessage = computed(() => {
    if (!(this.floatTouched() || this.submitted())) return null;
    const result = validateOpeningFloat(this.floatText());
    return result.ok ? null : FLOAT_MESSAGES[result.error];
  });
  /** Every register of the branch is taken: there is nothing to open. */
  protected readonly noFreeRegister = computed(
    () => this.visibleRegisters().length > 0 && this.visibleRegisters().every((r) => r.openShift !== null),
  );

  constructor() {
    this.form.controls.registerId.valueChanges.pipe(takeUntilDestroyed()).subscribe((v) => this.registerId.set(v));
    this.form.controls.openingFloat.valueChanges.pipe(takeUntilDestroyed()).subscribe((v) => {
      this.floatText.set(v);
      this.submitError.set(null);
    });
  }

  ngOnInit() {
    if (!this.ctx.can('sales.cash-register.open')) {
      this.state.set('forbidden');
      return;
    }
    this.load();
  }

  protected load() {
    this.state.set('loading');
    forkJoin({ registers: this.api.registers(), current: this.api.current() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ registers, current }) => {
          this.registers.set(registers.items);
          this.ownShift.set(current.shift);
          this.preselect();
          this.state.set('ready');
        },
        error: (err: unknown) => this.state.set(problemOf(err).status === 403 ? 'forbidden' : 'error'),
      });
  }

  /** With a single free register in view there is nothing to choose. */
  private preselect() {
    const free = this.visibleRegisters().filter((r) => r.openShift === null);
    if (free.length === 1) this.form.controls.registerId.setValue(free[0].id);
  }

  protected markFloatTouched() {
    this.floatTouched.set(true);
  }

  protected submit() {
    this.submitted.set(true);
    this.submitError.set(null);
    const parsed = validateOpeningFloat(this.floatText());
    const registerId = this.registerId();
    if (!registerId || !parsed.ok || this.saving() || this.ownShift()) return;

    this.saving.set(true);
    this.api
      .open({ registerId, openingFloat: parsed.value.toString() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.success('Caja abierta');
          void this.router.navigate(['/sales/pos']);
        },
        error: (err: unknown) => {
          this.saving.set(false);
          const problem = problemOf(err);
          this.submitError.set(problem.message);
          // somebody else took the register, or it changed: show the current state
          if (problem.code === 'CASH_REGISTER_ALREADY_OPEN' || problem.code === 'CASH_REGISTER_INACTIVE') this.load();
        },
      });
  }

  protected cancel() {
    void this.router.navigate(['/sales']);
  }
}
