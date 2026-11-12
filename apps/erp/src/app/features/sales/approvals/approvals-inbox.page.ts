import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import type { ApprovalInboxItem, ApprovalInboxResponse, ApprovalType } from '@rodasoft/domain';
import {
  ButtonComponent,
  EmptyStateIllustratedComponent,
  FilterChipComponent,
  KpiCardComponent,
  NoteComponent,
  PageHeaderComponent,
  RequestCardComponent,
  SkeletonComponent,
  ToastOutletComponent,
  ToastService,
} from '@rodasoft/ui';
import { catchError, map, of } from 'rxjs';
import { problemOf } from '../../../core/api-error';
import { ApprovalDecisionDialog, type ApprovalDecision } from './approval-decision.dialog';
import {
  APPROVAL_GROUP_LABELS,
  APPROVAL_TYPE_LABELS,
  APPROVAL_WHO_TEXT,
  approvalAmount,
  approvalDescription,
  approvalDetail,
  approvalDetailLink,
  approvalTitle,
  approvalTone,
  canDecideInline,
  oldestText,
} from './approval-format';
import { ApprovalsApi } from './approvals-api.service';
import { ApprovalsCountStore } from './approvals-count.store';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

/** A request ready to draw: the texts are worked out once per load, not on every change detection. */
interface Card {
  item: ApprovalInboxItem;
  kicker: string;
  title: string;
  description: string;
  detail: string;
  amount: string;
  tone: 'neutral' | 'negative';
  link: string;
  inline: boolean;
}

/**
 * VP-25 · Aprobaciones (HU-VEN-29). Everything that waits for a decision in one place, grouped by type: anulaciones, diferencias
 * de caja, devoluciones and gastos de caja (discounts have no approval, decision #5). Returns and cash expenses are approved or
 * rejected here with a comment; the other two open their own review page, where the shift or the sale is read in full. The
 * inbox only reads: every decision goes through the endpoint of its type, so its audit and side effects are unchanged.
 */
@Component({
  selector: 'rs-approvals-inbox-page',
  imports: [
    ApprovalDecisionDialog,
    ButtonComponent,
    EmptyStateIllustratedComponent,
    FilterChipComponent,
    KpiCardComponent,
    NoteComponent,
    PageHeaderComponent,
    RequestCardComponent,
    RouterLink,
    SkeletonComponent,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './approvals-inbox.page.html',
  styleUrl: './approvals-inbox.page.scss',
})
export class ApprovalsInboxPage {
  private readonly api = inject(ApprovalsApi);
  private readonly count = inject(ApprovalsCountStore);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly breadcrumbs = [{ label: 'Inicio', link: '/' }, { label: 'Ventas y POS', link: '/sales' }, { label: 'Aprobaciones' }];
  protected readonly whoText = APPROVAL_WHO_TEXT;
  protected readonly skeletonCards = Array.from({ length: 3 }, (_, i) => i);

  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly data = signal<ApprovalInboxResponse | null>(null);
  /** The chip chosen; null shows every type. */
  protected readonly selected = signal<ApprovalType | null>(null);
  /** When the list was read: the "hace N horas" of the cards count from here. */
  private readonly readAt = signal(new Date());

  protected readonly decisionOpen = signal(false);
  protected readonly decisionItem = signal<ApprovalInboxItem | null>(null);
  protected readonly decisionKind = signal<ApprovalDecision>('approve');

  protected readonly kpis = computed(() => {
    const k = this.data()?.kpis;
    return {
      pending: String(k?.pending ?? 0),
      oldest: oldestText(k?.oldestAt ?? null, this.readAt()),
      approved: String(k?.approvedToday ?? 0),
      rejected: String(k?.rejectedToday ?? 0),
    };
  });

  protected readonly pending = computed(() => this.data()?.kpis.pending ?? 0);
  protected readonly truncated = computed(() => this.data()?.truncated ?? false);

  protected readonly chips = computed(() => {
    const groups = this.data()?.groups ?? [];
    return [
      { key: null, label: `Todas (${this.pending()})` },
      ...groups.map((group) => ({ key: group.type as ApprovalType | null, label: `${APPROVAL_GROUP_LABELS[group.type]} (${group.count})` })),
    ];
  });

  /** The sections to draw: the chosen type, or every type that has something waiting. */
  protected readonly sections = computed(() => {
    const now = this.readAt();
    const chosen = this.selected();
    return (this.data()?.groups ?? [])
      .filter((group) => group.count > 0 && (chosen === null || group.type === chosen))
      .map((group) => ({
        type: group.type,
        heading: APPROVAL_GROUP_LABELS[group.type],
        count: group.count,
        cards: group.items.map(
          (item): Card => ({
            item,
            kicker: APPROVAL_TYPE_LABELS[item.type],
            title: approvalTitle(item),
            description: approvalDescription(item, now),
            detail: approvalDetail(item),
            amount: approvalAmount(item),
            tone: approvalTone(item),
            link: approvalDetailLink(item),
            inline: canDecideInline(item),
          }),
        ),
      }));
  });

  protected readonly showEmpty = computed(() => this.state() === 'ready' && this.pending() === 0);

  constructor() {
    this.load();
  }

  private fetch() {
    return this.api.list().pipe(
      map((data) => ({ data })),
      catchError((err: unknown) => of({ error: problemOf(err) })),
    );
  }

  private load() {
    this.state.set('loading');
    this.fetch()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => this.show(result));
  }

  private show(result: { data: ApprovalInboxResponse } | { error: ReturnType<typeof problemOf> }) {
    if ('error' in result) {
      this.errorMessage.set(result.error.message);
      this.state.set(result.error.status === 403 ? 'forbidden' : 'error');
      return;
    }
    this.data.set(result.data);
    this.readAt.set(new Date());
    // the chosen chip may have emptied with the last decision
    const chosen = this.selected();
    if (chosen !== null && !result.data.groups.some((group) => group.type === chosen && group.count > 0)) this.selected.set(null);
    this.count.set(result.data.kpis.pending);
    this.state.set('ready');
  }

  protected retry() {
    this.load();
  }

  protected choose(type: ApprovalType | null, selected: boolean) {
    // the chips act like one choice: clicking the chosen one keeps it
    if (selected) this.selected.set(type);
  }

  protected decide(item: ApprovalInboxItem, decision: ApprovalDecision) {
    this.decisionItem.set(item);
    this.decisionKind.set(decision);
    this.decisionOpen.set(true);
  }

  /** A decision was made (or someone else made it first): read the list again, without the skeleton, and refresh the badge. */
  protected onDecided() {
    this.fetch()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if ('data' in result) {
          this.show(result);
          return;
        }
        // the decision was registered: a list that still shows it deserves a warning, not silence
        this.count.refresh();
        this.toast.warning('La decisión se registró, pero no pudimos actualizar la lista. Recárgala.');
      });
  }
}
