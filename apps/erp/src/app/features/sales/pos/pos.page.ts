import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, OnInit, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import type { CashRegisterOption, CurrentCashShift } from '@rodasoft/domain';
import {
  ButtonComponent,
  EmptyStateIllustratedComponent,
  IllustrationComponent,
  NoteComponent,
  SkeletonComponent,
  ToastOutletComponent,
} from '@rodasoft/ui';
import { catchError, of } from 'rxjs';
import { problemOf } from '../../../core/api-error';
import { ContextStore } from '../../../core/context.store';
import { CashApi } from '../cash/cash-api.service';
import { registerPlace } from '../cash/cash-format';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * VP-14 · POS with the register closed. Without an open shift of the user, a card that cannot be dismissed ("Caja cerrada")
 * covers the page on a dimmed backdrop and the body behind it is inert. It is a dialog of its own, not `rs-modal`: the
 * Figma frame has no close button and must not be left with Escape or a click outside, only through its two buttons.
 * With a shift the body is a placeholder until HU-VEN-02 builds the sale screen and the full-screen POS layout.
 */
@Component({
  selector: 'rs-pos-page',
  imports: [ButtonComponent, EmptyStateIllustratedComponent, IllustrationComponent, NoteComponent, SkeletonComponent, ToastOutletComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pos.page.html',
  styleUrl: './pos.page.scss',
})
export class PosPage implements OnInit {
  private readonly api = inject(CashApi);
  private readonly ctx = inject(ContextStore);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  protected readonly state = signal<LoadState>('loading');
  protected readonly shift = signal<CurrentCashShift | null>(null);
  /** The registers of the user's branches, only fetched when the register is closed (to name the one they would open). */
  private readonly registers = signal<CashRegisterOption[]>([]);

  protected readonly closed = computed(() => this.state() === 'ready' && this.shift() === null);
  protected readonly canOpenRegister = computed(() => this.ctx.can('sales.cash-register.open'));

  /** The register named in the closed card: the only one of the branch in the ContextBar, when there is exactly one. */
  private readonly onlyRegister = computed(() => {
    const branch = this.ctx.currentBranch();
    const visible = branch ? this.registers().filter((r) => r.branch.id === branch.id) : this.registers();
    return visible.length === 1 ? visible[0] : null;
  });
  protected readonly closedText = computed(() => {
    if (!this.canOpenRegister()) return 'No tienes un turno abierto. Pide a un responsable de caja que abra tu turno.';
    const register = this.onlyRegister();
    return `No tienes un turno abierto${register ? ` en la ${register.name}` : ''}. Abre tu turno para empezar a vender.`;
  });

  /** `Caja 1 · Sucursal · Usuario` (Figma VP-14 header; the SIAT status chip comes with the full POS layout). */
  protected readonly description = computed(() => {
    const s = this.shift();
    if (s) return [registerPlace({ name: s.register.name, branch: s.branch }), s.openedBy.name].join(' · ');
    const register = this.onlyRegister();
    const place = register ? registerPlace(register) : this.ctx.currentBranch()?.name;
    return [place, this.ctx.context()?.user.name].filter(Boolean).join(' · ') || 'Caja cerrada';
  });

  constructor() {
    // focus moves into the card when it appears
    effect(() => this.dialog()?.nativeElement.querySelector<HTMLElement>('[data-autofocus]')?.focus());
  }

  ngOnInit() {
    if (!this.ctx.can('sales.pos.use')) {
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
          this.shift.set(shift);
          this.state.set('ready');
          if (shift === null && this.canOpenRegister()) this.loadRegisters();
        },
        error: (err: unknown) => this.state.set(problemOf(err).status === 403 ? 'forbidden' : 'error'),
      });
  }

  private loadRegisters() {
    this.api
      .registers()
      .pipe(
        catchError(() => of({ items: [] })),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ items }) => this.registers.set(items));
  }

  /** Keeps Tab inside the card, and ignores Escape: the card is left only through its buttons. */
  protected onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = Array.from(this.dialog()?.nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  protected leave() {
    void this.router.navigate(['/']);
  }

  protected openRegister() {
    void this.router.navigate(['/sales/cash-register/open']);
  }
}
