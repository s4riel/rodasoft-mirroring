import { toObservable, takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { computed, inject, Injectable, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import type { ProductDetail } from '@rodasoft/domain';
import { catchError, map, of, switchMap, tap } from 'rxjs';
import { problemOf } from '../../../../core/api-error';
import { ProductsApi } from '../products-api.service';

export type SheetLoadState = 'loading' | 'ready' | 'notfound' | 'forbidden' | 'error';

/**
 * Loads the product of the sheet route once and shares it with the header and the tab pages.
 * Provided by `ProductSheetPage`, so routed children (the tabs) inject the same instance.
 */
@Injectable()
export class ProductSheetStore {
  private readonly api = inject(ProductsApi);
  private readonly route = inject(ActivatedRoute);

  private readonly id = toSignal(this.route.paramMap.pipe(map((p) => p.get('id') ?? '')), { requireSync: true });
  private readonly reload = signal(0);

  readonly state = signal<SheetLoadState>('loading');
  readonly errorMessage = signal('');
  readonly product = signal<ProductDetail | null>(null);

  constructor() {
    toObservable(computed(() => ({ id: this.id(), reload: this.reload() })))
      .pipe(
        tap(() => this.state.set('loading')),
        switchMap(({ id }) =>
          this.api.detail(id).pipe(
            map((product) => ({ product })),
            catchError((err) => of({ error: problemOf(err) })),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        if ('error' in result) {
          this.errorMessage.set(result.error.message);
          const { status } = result.error;
          this.state.set(status === 404 ? 'notfound' : status === 403 ? 'forbidden' : 'error');
          return;
        }
        this.product.set(result.product);
        this.state.set('ready');
      });
  }

  retry() {
    this.reload.update((n) => n + 1);
  }
}
