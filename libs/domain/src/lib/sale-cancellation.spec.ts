import {
  CANCELLATION_COMMENT_MAX,
  CANCELLATION_REPLY_MAX,
  CANCELLATION_REASONS,
  cancellationImpact,
  cancellationWindowEndsAt,
  invoiceCancellationAction,
  invoiceCancellationEvent,
  isCancellableStatus,
  isCancellationReason,
  isWithinCancellationWindow,
  validateCancellationDecision,
  validateCancellationRequest,
} from './sale-cancellation';

describe('validateCancellationRequest', () => {
  it('accepts every known reason with a comment', () => {
    for (const reason of CANCELLATION_REASONS) expect(validateCancellationRequest({ reason, comment: 'Nombre mal escrito' })).toEqual([]);
  });

  it('rejects an unknown or missing reason', () => {
    expect(validateCancellationRequest({ reason: 'BORED', comment: 'x' })).toEqual(['REASON_INVALID']);
    expect(validateCancellationRequest({ reason: undefined, comment: 'x' })).toEqual(['REASON_INVALID']);
    expect(isCancellationReason('OTHER')).toBe(true);
    expect(isCancellationReason('other')).toBe(false);
  });

  it('requires a comment that is not blank', () => {
    expect(validateCancellationRequest({ reason: 'OTHER', comment: '' })).toEqual(['COMMENT_REQUIRED']);
    expect(validateCancellationRequest({ reason: 'OTHER', comment: '   \n ' })).toEqual(['COMMENT_REQUIRED']);
    expect(validateCancellationRequest({ reason: 'OTHER', comment: 12 })).toEqual(['COMMENT_REQUIRED']);
  });

  it('limits the comment length once trimmed', () => {
    expect(validateCancellationRequest({ reason: 'OTHER', comment: ` ${'a'.repeat(CANCELLATION_COMMENT_MAX)} ` })).toEqual([]);
    expect(validateCancellationRequest({ reason: 'OTHER', comment: 'a'.repeat(CANCELLATION_COMMENT_MAX + 1) })).toEqual(['COMMENT_TOO_LONG']);
  });

  it('reports every problem at once, reason first', () => {
    expect(validateCancellationRequest({ reason: 'NOPE', comment: '' })).toEqual(['REASON_INVALID', 'COMMENT_REQUIRED']);
  });
});

describe('cancellation window (decision #10)', () => {
  // 14 Oct 2026 23:30 in La Paz is 15 Oct 03:30 UTC: the sale belongs to the 14th, not to the 15th
  const lateSale = new Date('2026-10-15T03:30:00Z');

  it('has no end while there is no limit', () => {
    expect(cancellationWindowEndsAt(lateSale, null)).toBeNull();
    expect(isWithinCancellationWindow(new Date('2030-01-01T00:00:00Z'), lateSale, null)).toBe(true);
  });

  it('counts La Paz calendar days: 0 days means the same day only', () => {
    expect(cancellationWindowEndsAt(lateSale, 0)?.toISOString()).toBe('2026-10-15T04:00:00.000Z');
    expect(isWithinCancellationWindow(new Date('2026-10-15T03:59:59Z'), lateSale, 0)).toBe(true);
    expect(isWithinCancellationWindow(new Date('2026-10-15T04:00:00Z'), lateSale, 0)).toBe(false);
  });

  it('allows the sale day plus N more days, to the end of the last one', () => {
    expect(cancellationWindowEndsAt(lateSale, 2)?.toISOString()).toBe('2026-10-17T04:00:00.000Z');
    expect(isWithinCancellationWindow(new Date('2026-10-17T03:00:00Z'), lateSale, 2)).toBe(true);
    expect(isWithinCancellationWindow(new Date('2026-10-17T05:00:00Z'), lateSale, 2)).toBe(false);
  });

  it('crosses a month end', () => {
    expect(cancellationWindowEndsAt(new Date('2026-10-31T15:00:00Z'), 1)?.toISOString()).toBe('2026-11-02T04:00:00.000Z');
  });
});

describe('isCancellableStatus', () => {
  it('only a completed sale can be asked to be cancelled', () => {
    expect(isCancellableStatus('COMPLETED')).toBe(true);
    expect(isCancellableStatus('CANCELLATION_PENDING')).toBe(false);
    expect(isCancellableStatus('CANCELLED')).toBe(false);
  });
});

describe('validateCancellationDecision', () => {
  it('lets an approval go without a reply', () => {
    expect(validateCancellationDecision({ decision: 'APPROVE', comment: undefined })).toEqual([]);
    expect(validateCancellationDecision({ decision: 'APPROVE', comment: '  ' })).toEqual([]);
  });

  it('asks a rejection for the reason, judged trimmed', () => {
    expect(validateCancellationDecision({ decision: 'REJECT', comment: undefined })).toEqual(['COMMENT_REQUIRED']);
    expect(validateCancellationDecision({ decision: 'REJECT', comment: '   ' })).toEqual(['COMMENT_REQUIRED']);
    expect(validateCancellationDecision({ decision: 'REJECT', comment: 'No procede' })).toEqual([]);
  });

  it('caps the reply for both decisions', () => {
    const long = 'x'.repeat(CANCELLATION_REPLY_MAX + 1);
    expect(validateCancellationDecision({ decision: 'APPROVE', comment: long })).toEqual(['COMMENT_TOO_LONG']);
    expect(validateCancellationDecision({ decision: 'REJECT', comment: 'x'.repeat(CANCELLATION_REPLY_MAX) })).toEqual([]);
  });
});

describe('invoice cancellation', () => {
  it('voids an invoice that never left, asks the SIAT for a valid one and refuses the rest', () => {
    for (const status of ['PENDING', 'REJECTED'] as const) {
      expect(invoiceCancellationAction(status)).toBe('VOID');
      expect(invoiceCancellationEvent(status)).toBe('void');
    }
    expect(invoiceCancellationAction('VALID')).toBe('REQUEST_SIAT_CANCELLATION');
    expect(invoiceCancellationEvent('VALID')).toBe('requestCancellation');
    for (const status of ['SENDING', 'CANCELLATION_PENDING', 'CANCELLED'] as const) {
      expect(invoiceCancellationAction(status)).toBe('BLOCKED');
      expect(invoiceCancellationEvent(status)).toBeNull();
    }
  });
});

describe('cancellationImpact', () => {
  const lines = [{ quantity: 4 }, { quantity: 3 }, { quantity: 1 }];

  it('refunds the cash the sale kept and returns every unit', () => {
    expect(cancellationImpact({ invoiceStatus: 'PENDING', lines, payments: [{ method: 'CASH', amount: '1280.00' }] })).toEqual({
      invoiceAction: 'VOID',
      stockUnits: 8,
      cashRefund: '1280.00',
      manualRefunds: [],
    });
  });

  it('splits a mixed sale into the cash the register gives back and the QR left to refund by hand', () => {
    const impact = cancellationImpact({
      invoiceStatus: 'VALID',
      lines,
      payments: [
        { method: 'CASH', amount: '300.50' },
        { method: 'QR', amount: '979.50' },
      ],
    });
    expect(impact.cashRefund).toBe('300.50');
    expect(impact.manualRefunds).toEqual([{ method: 'QR', amount: '979.50' }]);
    expect(impact.invoiceAction).toBe('REQUEST_SIAT_CANCELLATION');
  });

  it('leaves a card payment to refund by hand and a credit one with nothing to refund', () => {
    const card = cancellationImpact({ invoiceStatus: 'PENDING', lines, payments: [{ method: 'CARD', amount: '100.00' }] });
    expect(card.cashRefund).toBe('0.00');
    expect(card.manualRefunds).toEqual([{ method: 'CARD', amount: '100.00' }]);
    const credit = cancellationImpact({ invoiceStatus: 'PENDING', lines, payments: [{ method: 'CREDIT', amount: '100.00' }] });
    expect(credit.cashRefund).toBe('0.00');
    expect(credit.manualRefunds).toEqual([]);
  });
});
