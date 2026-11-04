import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, OnInit, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  Decimal,
  posEquivalentSummary,
  type EquivalenceDifference,
  type EquivalenceMeasures,
  type PosEquivalentItem,
  type PosEquivalentsResponse,
} from '@rodasoft/domain';
import { ButtonComponent, PosResultRowComponent, SkeletonComponent } from '@rodasoft/ui';
import { problemOf } from '../../../core/api-error';
import { PosApi } from './pos-api.service';

type PanelState = 'loading' | 'ready' | 'error';

/** "40 × 80 × 18", or null when a measure is missing. */
function measuresText(m: EquivalenceMeasures | null): string | null {
  if (!m || m.innerDiameter === null || m.outerDiameter === null || m.width === null) return null;
  return [m.innerDiameter, m.outerDiameter, m.width].join(' × ');
}

/** "Sello: 2RS → 2Z"; a missing value is a dash. */
function differenceText(d: EquivalenceDifference): string {
  return `${d.label}: ${d.source ?? '—'} → ${d.other ?? '—'}`;
}

/**
 * VP-03b · Equivalents of an out-of-stock product (HU-VEN-03). Opens under the result row: the heading, one row per
 * equivalent with how it differs from the original, its stock and Agregar, and the original's stock in other branches.
 * It loads its own data when it appears; the page decides when it is shown and does the adding (HU-VEN-02 cart).
 */
@Component({
  selector: 'rs-pos-equivalents-panel',
  imports: [ButtonComponent, PosResultRowComponent, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pos-equivalents-panel.html',
  styleUrl: './pos-equivalents-panel.scss',
})
export class PosEquivalentsPanel implements OnInit {
  private readonly api = inject(PosApi);
  private readonly destroyRef = inject(DestroyRef);

  /** The out-of-stock product. */
  readonly productId = input.required<string>();
  readonly code = input.required<string>();
  /** Warehouse of the register, named in the heading and in each row's stock. */
  readonly warehouseName = input.required<string>();
  /** Products being added right now: their Agregar waits for the answer. */
  readonly adding = input<ReadonlySet<string>>(new Set());

  /** Agregar of an equivalent. */
  readonly add = output<PosEquivalentItem>();
  /** The eye button of an equivalent: its product id, to open the technical sheet (HU-VEN-04). */
  readonly detail = output<string>();
  /** The request failed; the page checks whether the cash shift was lost. */
  readonly loadFailed = output<unknown>();

  protected readonly state = signal<PanelState>('loading');
  protected readonly data = signal<PosEquivalentsResponse | null>(null);
  protected readonly forbidden = signal(false);
  private requesting = false;

  ngOnInit() {
    this.load();
  }

  protected load() {
    // a second Reintentar while the first request runs would race it
    if (this.requesting) return;
    this.requesting = true;
    this.state.set('loading');
    this.api
      .equivalents(this.productId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.requesting = false;
          this.data.set(res);
          this.state.set('ready');
        },
        error: (err: unknown) => {
          this.requesting = false;
          this.forbidden.set(problemOf(err).status === 403);
          this.state.set('error');
          this.loadFailed.emit(err);
        },
      });
  }

  /** Second line of a row: "Exacta · 40 × 80 × 18 · SKF" or "Con diferencias · blindaje metálico en vez de sello · FAG". */
  protected description(item: PosEquivalentItem): string {
    const summary = posEquivalentSummary(item.kind, item.differences, item.notes, item.measures);
    const parts: string[] = [];
    if (item.substitute) parts.push('Sustituto');
    if (summary.kind === 'EXACT') {
      parts.push('Exacta');
      const measures = measuresText(summary.measures);
      if (measures) parts.push(measures);
    } else {
      parts.push('Con diferencias');
      const detail = summary.note ?? summary.differences.map(differenceText).join(', ');
      if (detail) parts.push(detail);
    }
    parts.push(item.brand.name);
    return parts.join(' · ');
  }

  protected stockLabel(item: PosEquivalentItem): string {
    return `${item.available} en ${this.warehouseName()}`;
  }

  protected price(value: string): string {
    return Decimal.of(value).format();
  }

  protected isAdding(productId: string): boolean {
    return this.adding().has(productId);
  }

  /** "Sacaba 4 uds · Panamericana 2 uds". */
  protected otherBranchesText(res: PosEquivalentsResponse): string {
    return res.otherBranches.map((b) => `${b.branchName} ${b.available} uds`).join(' · ');
  }
}
