import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { CodeHealth, SiatPointOfSaleStatus, SiatSystemStatus } from '@rodasoft/domain';
import {
  ButtonComponent,
  CanDirective,
  type DocTableColumn,
  DocTableCellDirective,
  DocTableComponent,
  type DocTableRow,
  EmptyStateIllustratedComponent,
  KpiCardComponent,
  NoteComponent,
  PageHeaderComponent,
  RowActionComponent,
  SkeletonComponent,
  ToastOutletComponent,
  ToastService,
} from '@rodasoft/ui';
import { firstValueFrom } from 'rxjs';
import { problemOf } from '../../core/api-error';
import { formatDateTime } from '../sales/cash/cash-format';
import { CODE_HEALTH_PILLS, codeExpiryLabel, formatCodeExpiry } from './credit-note-format';
import { InvoicingApi } from './invoicing-api.service';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

/** The columns of the Figma table of FS-05 and FS-11, in its order. */
const COLUMNS: DocTableColumn[] = [
  { key: 'point', label: 'PV', type: 'code', width: '7rem' },
  { key: 'branch', label: 'Sucursal', type: 'text' },
  { key: 'sync', label: 'Última sync.', type: 'text', width: '11rem' },
  { key: 'codes', label: 'CUIS · CUFD vencen', type: 'text', width: '16rem' },
  { key: 'issued', label: 'Emitidas hoy', type: 'number', width: '9rem' },
  { key: 'status', label: 'Estado', type: 'status', width: '13rem' },
  { key: 'actions', label: '', type: 'custom', align: 'end', width: '3.5rem' },
];

const HEALTH_RANK: Record<CodeHealth, number> = { OK: 0, EXPIRING: 1, EXPIRED: 2 };
const worst = (point: SiatPointOfSaleStatus): CodeHealth => (HEALTH_RANK[point.cuis.health] >= HEALTH_RANK[point.cufd.health] ? point.cuis.health : point.cufd.health);
/** The earliest of the given expiries, or null when none has one. */
const earliest = (dates: (string | null)[]): string | null => dates.filter((d): d is string => d !== null).sort()[0] ?? null;

/**
 * FS-05 / FS-11 · SIAT system status (HU-FAC-13): the connection, the CUIS and CUFD of every point of sale by branch with their health,
 * and the two actions of whoever manages the SIAT settings: test the connection and renew a CUFD. The connection is separate from the
 * validity of the codes: online does not mean authorised to issue. There is no contingency: when the SIAT is down the invoices wait.
 */
@Component({
  selector: 'rs-siat-status-page',
  imports: [
    ButtonComponent,
    CanDirective,
    DocTableCellDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    KpiCardComponent,
    NoteComponent,
    PageHeaderComponent,
    RowActionComponent,
    SkeletonComponent,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './siat-status.page.html',
  styleUrl: './siat-status.page.scss',
})
export class SiatStatusPage {
  private readonly api = inject(InvoicingApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  protected readonly breadcrumbs = [{ label: 'Inicio', link: '/' }, { label: 'Facturación SIAT' }, { label: 'Estado del sistema' }];
  protected readonly columns = COLUMNS;
  protected readonly skeletonRows = Array.from({ length: 3 }, (_, i) => i);
  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly data = signal<SiatSystemStatus | null>(null);
  protected readonly testing = signal(false);
  /** The point of sale whose CUFD is being renewed. */
  protected readonly renewing = signal<string | null>(null);

  protected readonly online = computed(() => this.data()?.connection === 'ONLINE');
  protected readonly offline = computed(() => this.data()?.connection === 'OFFLINE');
  protected readonly points = computed<SiatPointOfSaleStatus[]>(() => (this.data()?.branches ?? []).flatMap((b) => b.pointsOfSale));
  protected readonly branchOf = computed(() => new Map((this.data()?.branches ?? []).flatMap((b) => b.pointsOfSale.map((p) => [p.id, b.branchName] as const))));
  protected readonly rows = computed<DocTableRow[]>(() =>
    this.points().map((p) => ({
      id: p.id,
      cells: {
        point: String(p.code),
        branch: this.branchOf().get(p.id) ?? '',
        sync: p.lastSyncedAt ? formatDateTime(p.lastSyncedAt) : 'Sin sincronizar',
        codes: `${codeExpiryLabel(p.cuis.expiresAt, p.cuis.present, formatCodeExpiry)} · ${codeExpiryLabel(p.cufd.expiresAt, p.cufd.present, formatCodeExpiry)}`,
        issued: p.issuedToday,
        status: { ...CODE_HEALTH_PILLS[worst(p)], tooltip: `CUIS: ${CODE_HEALTH_PILLS[p.cuis.health].label.toLowerCase()} · CUFD: ${CODE_HEALTH_PILLS[p.cufd.health].label.toLowerCase()}` },
      },
    })),
  );
  protected readonly totals = computed(() => ({
    point: 'Total',
    branch: `${this.points().length} ${this.points().length === 1 ? 'punto de venta' : 'puntos de venta'}`,
    sync: '',
    codes: '',
    issued: this.points().reduce((sum, p) => sum + p.issuedToday, 0),
    actions: '',
  }));

  protected readonly headline = computed(() => {
    const d = this.data();
    if (!d) return '';
    if (d.connection === 'ONLINE') return 'SIAT en línea';
    if (d.connection === 'OFFLINE') return 'Error de conexión con el SIAT';
    return 'Conexión con el SIAT sin verificar';
  });
  protected readonly connectionText = computed(() => {
    const d = this.data();
    if (!d) return '';
    if (d.connection === 'UNKNOWN') return 'Sin verificar';
    return d.connection === 'ONLINE' ? 'En línea' : 'Sin conexión';
  });
  protected readonly checkedText = computed(() => (this.data()?.checkedAt ? `Verificada ${formatDateTime(this.data()?.checkedAt as string)}` : 'Todavía no se verificó'));
  /** "Vence 14/11/2026" for the CUIS that expires first, or "Vencido" when a point of sale has none valid. */
  protected readonly cuisText = computed(() => this.expiryText(this.data()?.cuis, this.points().map((p) => p.cuis.expiresAt)));
  protected readonly cufdText = computed(() => this.expiryText(this.data()?.cufd, this.points().map((p) => p.cufd.expiresAt)));
  /** Points of sale whose CUFD is not valid for long: what the bottom "Renovar CUFD" renews. */
  protected readonly renewable = computed(() => this.points().filter((p) => p.cufd.health !== 'OK'));
  protected readonly syncText = computed(() => (this.data()?.lastSyncedAt ? formatDateTime(this.data()?.lastSyncedAt as string) : 'Sin sincronizar'));
  protected readonly codesOk = computed(() => this.data()?.cuis === 'OK' && this.data()?.cufd === 'OK');

  constructor() {
    this.load();
  }

  protected load() {
    this.state.set('loading');
    this.api
      .systemStatus()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.data.set(data);
          this.state.set('ready');
        },
        error: (err) => {
          const problem = problemOf(err);
          this.errorMessage.set(problem.message);
          this.state.set(problem.status === 403 ? 'forbidden' : 'error');
        },
      });
  }

  private expiryText(health: CodeHealth | undefined, expiries: (string | null)[]): string {
    if (health === undefined || health === 'EXPIRED') return 'Vencido';
    const first = earliest(expiries);
    return first ? `Vence ${formatCodeExpiry(first)}` : 'Vencido';
  }

  protected readonly menu = [{ key: 'renew', label: 'Renovar CUFD', icon: 'transfer' as const }];

  protected onAction(point: SiatPointOfSaleStatus, key: string) {
    if (key === 'renew') void this.renew(point);
  }

  /** The bottom "Renovar CUFD": every point of sale whose CUFD is expiring or expired, one after the other. */
  protected async renewAll() {
    for (const point of this.renewable()) await this.renew(point, false);
    this.load();
  }

  protected pointOf(rowId: string): SiatPointOfSaleStatus | null {
    return this.points().find((p) => p.id === rowId) ?? null;
  }

  protected async testConnection() {
    if (this.testing()) return;
    this.testing.set(true);
    try {
      await firstValueFrom(this.api.testConnection());
      this.toast.success('El SIAT responde: conexión en línea');
    } catch (err) {
      this.toast.danger(problemOf(err).message);
    } finally {
      this.testing.set(false);
      this.load();
    }
  }

  protected async renew(point: SiatPointOfSaleStatus, reload = true) {
    if (this.renewing()) return;
    this.renewing.set(point.id);
    try {
      await firstValueFrom(this.api.renewCufd(point.id));
      this.toast.success(`CUFD del punto de venta ${point.code} renovado`);
      if (reload) this.load();
    } catch (err) {
      // the old CUFD is kept: the message says why (usually the SIAT does not answer)
      this.toast.danger(problemOf(err).message);
    } finally {
      this.renewing.set(null);
    }
  }
}
