import { CallHandler, ExecutionContext, Injectable, NestInterceptor, PayloadTooLargeException } from '@nestjs/common';
import { catchError, type Observable, throwError } from 'rxjs';
import { cashMovementErrors } from './cash.errors';

/** The most the multipart parser keeps in memory for a receipt: a little over the 5 MB limit, so the domain rule answers files over it. */
export const RECEIPT_PARSE_LIMIT_BYTES = 6 * 1024 * 1024;

/** Multer reports a file over its limit as a bare 413; this gives it the `RECEIPT_TOO_LARGE` code of the cash contract. */
@Injectable()
export class ReceiptLimitInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((err: unknown) => {
        const coded = err instanceof PayloadTooLargeException && typeof err.getResponse() === 'object' && 'code' in (err.getResponse() as object);
        return throwError(() => (err instanceof PayloadTooLargeException && !coded ? cashMovementErrors.receiptTooLarge() : err));
      }),
    );
  }
}
