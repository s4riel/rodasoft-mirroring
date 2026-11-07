import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import type { QuoteDetail } from '@rodasoft/domain';
import { ButtonComponent, EmptyStateIllustratedComponent, ReceiptComponent, SkeletonComponent } from '@rodasoft/ui';
import { problemOf } from '../../../core/api-error';
import { quoteDocument } from './quote-tracking-format';
import { QuotesApi } from './quotes-api.service';

type LoadState = 'loading' | 'ready' | 'forbidden' | 'error';

/**
 * The printed copy of a quote (HU-VEN-17 "Descargar PDF"), opened in its own tab. It draws the quote with `rs-receipt` on
 * letter paper and opens the print dialog, where the user picks "Guardar como PDF". Outside the ERP shell.
 */
@Component({
  selector: 'rs-quote-print-page',
  imports: [ButtonComponent, EmptyStateIllustratedComponent, ReceiptComponent, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './quote-print.page.html',
  styleUrl: './quote-print.page.scss',
})
export class QuotePrintPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(QuotesApi);
  private readonly doc = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly state = signal<LoadState>('loading');
  protected readonly quote = signal<QuoteDetail | null>(null);
  protected readonly errorText = signal('');
  protected readonly document = computed(() => {
    const quote = this.quote();
    return quote ? quoteDocument(quote) : null;
  });

  ngOnInit() {
    this.load();
  }

  protected load() {
    this.state.set('loading');
    this.api
      .detail(this.route.snapshot.paramMap.get('id') ?? '')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (quote) => {
          this.quote.set(quote);
          this.state.set('ready');
          // the quote is drawn before the print dialog opens
          setTimeout(() => this.print());
        },
        error: (err: unknown) => {
          const problem = problemOf(err);
          this.errorText.set(problem.message);
          this.state.set(problem.status === 403 ? 'forbidden' : 'error');
        },
      });
  }

  protected print() {
    this.doc.defaultView?.print();
  }
}
