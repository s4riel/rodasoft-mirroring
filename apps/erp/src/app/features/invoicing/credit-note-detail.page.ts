import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { CreditNoteDetail } from '@rodasoft/domain';
import {
  ButtonComponent,
  DataFieldComponent,
  EmptyStateIllustratedComponent,
  KpiCardComponent,
  NoteComponent,
  PageHeaderComponent,
  SkeletonComponent,
  StatusPillComponent,
  StatusTimelineComponent,
  type StatusTimelineStep,
  ToastOutletComponent,
  ToastService,
} from '@rodasoft/ui';
import { firstValueFrom } from 'rxjs';
import { problemOf } from '../../core/api-error';
import { formatBs, formatDateTime, formatTime } from '../sales/cash/cash-format';
import { documentNumberLabel, noteHistoryLabel, noteOriginLabel, noteReasonLabel, NOTE_STATUS_PILLS } from './credit-note-format';
import { saveBlob } from './file-download';
import { INVOICE_STATUS_PILLS } from './invoice-format';
import { InvoicingApi } from './invoicing-api.service';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden' | 'not-found';

/** FS-24 · One credit and debit note: the amount credited, the VAT it adjusts, the original invoice, what it credits, and its SIAT history (HU-FAC-11). */
@Component({
  selector: 'rs-credit-note-detail-page',
  imports: [
    ButtonComponent,
    DataFieldComponent,
    EmptyStateIllustratedComponent,
    KpiCardComponent,
    NoteComponent,
    PageHeaderComponent,
    RouterLink,
    SkeletonComponent,
    StatusPillComponent,
    StatusTimelineComponent,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './credit-note-detail.page.html',
  styleUrl: './credit-note-detail.page.scss',
})
export class CreditNoteDetailPage {
  private readonly api = inject(InvoicingApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  protected readonly skeletonRows = Array.from({ length: 4 }, (_, i) => i);
  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly detail = signal<CreditNoteDetail | null>(null);
  protected readonly busy = signal(false);

  private readonly id = this.route.snapshot.paramMap.get('id') ?? '';

  protected readonly numberText = computed(() => documentNumberLabel(this.detail()?.number ?? null));
  protected readonly title = computed(() => (this.detail() ? `Nota de crédito y débito ${this.numberText()}` : 'Nota de crédito y débito'));
  protected readonly subtitle = computed(() => {
    const d = this.detail();
    return d ? `${d.customerName} · factura ${documentNumberLabel(d.invoiceNumber)}${d.issuedAt ? ` · ${formatDateTime(d.issuedAt)}` : ''}` : '';
  });
  protected readonly breadcrumbs = computed(() => [
    { label: 'Inicio', link: '/' },
    { label: 'Facturación SIAT' },
    { label: 'Notas de crédito', link: '/invoicing/notes' },
    { label: this.detail() ? `Nota ${this.numberText()}` : 'Nota' },
  ]);
  protected readonly pill = computed(() => (this.detail() ? NOTE_STATUS_PILLS[this.detail()?.status ?? 'PENDING'] : null));
  /** One line per credited product, as the Figma card prints it: "Rodamiento rígido · 1 pieza · Bs 245,00". */
  protected readonly lines = computed(() =>
    (this.detail()?.lines ?? []).map((line) => ({
      code: line.code,
      text: [line.description, line.quantity > 0 ? `${line.quantity} ${line.quantity === 1 ? 'pieza' : 'piezas'}` : 'ajuste de precio', formatBs(line.amount)].join(' · '),
    })),
  );
  protected readonly originalInvoiceText = computed(() => {
    const invoice = this.detail()?.invoice;
    return invoice ? [documentNumberLabel(invoice.number), invoice.issuedAt ? formatDateTime(invoice.issuedAt) : null, formatBs(invoice.total)].filter(Boolean).join(' · ') : '';
  });
  /** The steps of the Figma status card: created, sent to the SIAT, validated (or stopped there). */
  protected readonly timeline = computed<StatusTimelineStep[]>(() => {
    const d = this.detail();
    if (!d) return [];
    const sentAt = d.history.find((h) => h.action === 'invoicing.note.issue')?.at;
    const sent: StatusTimelineStep = sentAt
      ? { label: 'Enviada al SIAT', caption: formatTime(sentAt), state: 'done', stateLabel: 'Completado' }
      : { label: 'Enviada al SIAT', caption: '—', state: d.status === 'PENDING' ? 'current' : 'pending', stateLabel: 'Pendiente' };
    let last: StatusTimelineStep;
    if (d.status === 'VALID') last = { label: 'Validada', caption: `${formatTime(d.issuedAt ?? d.createdAt)} · SIAT en línea`, state: 'done', stateLabel: 'Completado' };
    else if (d.status === 'REJECTED') last = { label: 'Rechazada por el SIAT', caption: d.rejectionMessage ?? '—', state: 'warning', stateLabel: 'Rechazada' };
    else if (d.status === 'CANCELLED') last = { label: 'Anulada', caption: '—', state: 'warning', stateLabel: 'Anulada' };
    else last = { label: 'Validada', caption: '—', state: d.status === 'SENDING' ? 'current' : 'pending', stateLabel: 'Pendiente' };
    return [{ label: 'Emitida', caption: formatTime(d.createdAt), state: 'done', stateLabel: 'Completado' }, sent, last];
  });
  protected readonly originText = computed(() => (this.detail() ? noteOriginLabel(this.detail() as CreditNoteDetail) : ''));
  protected readonly reasonText = computed(() => noteReasonLabel(this.detail()?.reasonCode ?? 5));
  protected readonly invoiceText = computed(() => {
    const invoice = this.detail()?.invoice;
    return invoice ? `${documentNumberLabel(invoice.number)} · ${INVOICE_STATUS_PILLS[invoice.status].label.toLowerCase()}` : '';
  });
  protected readonly history = computed(() =>
    (this.detail()?.history ?? []).map((h) => ({ at: formatTime(h.at), text: noteHistoryLabel(h.action), actor: h.actor, detail: h.detail })),
  );
  protected readonly canIssue = computed(() => this.detail()?.actions.includes('ISSUE') ?? false);
  protected readonly canVoid = computed(() => this.detail()?.actions.includes('VOID') ?? false);
  protected readonly hasDocuments = computed(() => this.detail()?.actions.includes('DOWNLOAD_PDF') ?? false);

  constructor() {
    this.load();
  }

  protected load() {
    this.state.set('loading');
    this.api
      .note(this.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.detail.set(detail);
          this.state.set('ready');
        },
        error: (err) => {
          const problem = problemOf(err);
          this.errorMessage.set(problem.message);
          this.state.set(problem.status === 403 ? 'forbidden' : problem.status === 404 ? 'not-found' : 'error');
        },
      });
  }

  protected back() {
    void this.router.navigate(['/invoicing/notes']);
  }

  /** "Emitir en el SIAT": the answer arrives a moment later, in the worker. */
  protected async issue() {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.issueNote(this.id));
      this.toast.success('Nota enviada al SIAT');
      this.load();
    } catch (err) {
      this.toast.danger(problemOf(err).message);
    } finally {
      this.busy.set(false);
    }
  }

  /** "Anular nota": gives up a note the SIAT never validated, so it stops reserving what it credited. */
  protected async voidNote() {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.voidNote(this.id));
      this.toast.success('Nota anulada');
      this.load();
    } catch (err) {
      this.toast.danger(problemOf(err).message);
    } finally {
      this.busy.set(false);
    }
  }

  /** "Imprimir nota": opens the printed note in a new tab, where the browser prints it. */
  protected async print() {
    try {
      const blob = await firstValueFrom(this.api.notePdf(this.id));
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      this.toast.danger(problemOf(err).message);
    }
  }

  protected async download(format: 'pdf' | 'xml') {
    try {
      const blob = await firstValueFrom(format === 'pdf' ? this.api.notePdf(this.id) : this.api.noteXml(this.id));
      saveBlob(blob, `nota-credito-debito-${String(this.detail()?.number ?? 0).padStart(6, '0')}.${format}`);
    } catch (err) {
      this.toast.danger(problemOf(err).message);
    }
  }

  protected money(value: string): string {
    return formatBs(value);
  }
}
