import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { type FiscalChecklistRow, type FiscalSettingsSummary, PRODUCTION_REQUIREMENT_LABELS } from '@rodasoft/domain';
import {
  ButtonComponent,
  CanDirective,
  LinkComponent,
  DocTableCellDirective,
  type DocTableColumn,
  DocTableComponent,
  EmptyStateIllustratedComponent,
  KpiCardComponent,
  NoteComponent,
  PageHeaderComponent,
  SkeletonComponent,
  ToastOutletComponent,
} from '@rodasoft/ui';
import { problemOf } from '../../core/api-error';
import { formatDateTime } from '../sales/cash/cash-format';
import { SECTION_LABELS, SECTION_PILLS, sectionDetail } from './fiscal-format';
import { InvoicingApi } from './invoicing-api.service';
import { ProductionDialog } from './production.dialog';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

const COLUMNS: DocTableColumn[] = [
  { key: 'section', label: 'Sección', type: 'text', width: '16rem' },
  { key: 'description', label: 'Qué incluye', type: 'text' },
  { key: 'detail', label: 'Detalle', type: 'text', width: '14rem' },
  { key: 'status', label: 'Estado', type: 'status', width: '9rem' },
  { key: 'link', label: '', type: 'custom', align: 'end', width: '8rem' },
];

/**
 * FS-07 · Fiscal configuration (HU-FAC-22): the status of every section (signature, credentials, connection, points of sale,
 * catalogues, activity, homologation), each one linking to its page, and the switch to production (FS-36, HU-FAC-27).
 */
@Component({
  selector: 'rs-fiscal-settings-page',
  imports: [
    ButtonComponent,
    CanDirective,
    LinkComponent,
    DocTableCellDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    KpiCardComponent,
    NoteComponent,
    PageHeaderComponent,
    ProductionDialog,
    RouterLink,
    SkeletonComponent,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './fiscal-settings.page.html',
  styleUrl: './fiscal-settings.page.scss',
})
export class FiscalSettingsPage {
  private readonly api = inject(InvoicingApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly columns = COLUMNS;
  protected readonly skeletonRows = Array.from({ length: 5 }, (_, i) => i);
  protected readonly breadcrumbs = [{ label: 'Inicio', link: '/' }, { label: 'Facturación SIAT' }, { label: 'Configuración fiscal' }];

  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly data = signal<FiscalSettingsSummary | null>(null);
  protected readonly productionOpen = signal(false);

  protected readonly isProduction = computed(() => this.data()?.environment === 'PRODUCTION');
  protected readonly rows = computed(() =>
    (this.data()?.checklist ?? []).map((row) => ({
      id: row.key,
      label: SECTION_LABELS[row.key].title,
      cells: { section: SECTION_LABELS[row.key].title, description: SECTION_LABELS[row.key].description, detail: sectionDetail(row), status: SECTION_PILLS[row.status] },
    })),
  );
  protected readonly environmentText = computed(() => (this.isProduction() ? 'Producción' : 'Pruebas'));
  protected readonly credentialsText = computed(() => {
    const c = this.data()?.credentials;
    return c?.tokenPresent && c.tokenExpiresAt ? `Vencen ${formatDateTime(c.tokenExpiresAt).slice(0, 10)}` : 'Sin cargar';
  });
  protected readonly catalogsText = computed(() => {
    const c = this.data()?.catalogs;
    return c?.synced && c.syncedAt ? `Sync ${formatDateTime(c.syncedAt)}` : 'Sin sincronizar';
  });
  /** The Figma total row: how many sections are complete and how many need attention. */
  protected readonly totals = computed(() => {
    const list = this.data()?.checklist ?? [];
    const done = list.filter((row) => row.status === 'OK').length;
    return { section: 'Total', description: `${list.length} secciones · ${done} completas · ${list.length - done} por atender` };
  });
  protected readonly productionMissing = computed(() => (this.data()?.production.requirements ?? []).map((code) => PRODUCTION_REQUIREMENT_LABELS[code]));
  protected readonly signatureText = computed(() => {
    const s = this.data()?.signature;
    return s?.present && s.expiresAt ? `Vence el ${formatDateTime(s.expiresAt).slice(0, 10)}` : 'Sin cargar';
  });
  protected readonly expiring = computed(() => {
    const d = this.data();
    if (!d) return [];
    const items: string[] = [];
    if (d.signature.present && d.signature.health !== 'OK') items.push(d.signature.health === 'EXPIRED' ? 'La firma digital está vencida.' : 'La firma digital está por vencer.');
    if (d.credentials.tokenPresent && d.credentials.tokenHealth !== 'OK') items.push(d.credentials.tokenHealth === 'EXPIRED' ? 'El token del SIAT está vencido.' : 'El token del SIAT está por vencer.');
    return items;
  });

  constructor() {
    this.load();
  }

  protected load() {
    this.state.set('loading');
    this.api
      .fiscalSettings()
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

  protected linkOf(row: FiscalChecklistRow['key'] | string): string {
    return SECTION_LABELS[row as FiscalChecklistRow['key']]?.link ?? '/invoicing/settings';
  }

  protected titleOf(row: string): string {
    return SECTION_LABELS[row as FiscalChecklistRow['key']]?.title ?? row;
  }

  protected switched() {
    this.load();
  }
}
