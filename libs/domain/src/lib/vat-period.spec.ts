import { InvalidTransitionError, vatPeriodMachine } from './state-machine';
import { canClosePeriod, isVatPeriodStatus, listPeriods, nextVatPeriod, periodCloseBlockers, previousVatPeriod, validateReopenReason, vatPeriodActions } from './vat-period';

describe('periods', () => {
  it('moves to the next and previous month across a year', () => {
    expect(nextVatPeriod('2026-11')).toBe('2026-12');
    expect(nextVatPeriod('2026-12')).toBe('2027-01');
    expect(previousVatPeriod('2027-01')).toBe('2026-12');
    expect(previousVatPeriod('2026-03')).toBe('2026-02');
  });

  it('lists the months from the first one to the current La Paz month', () => {
    // 03:30 UTC on 1 Jan 2027 is still December in La Paz
    expect(listPeriods('2026-11', new Date('2027-01-01T03:30:00Z'))).toEqual(['2026-11', '2026-12']);
    expect(listPeriods('2026-11', new Date('2027-01-01T04:00:00Z'))).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(listPeriods('2027-02', new Date('2027-01-15T12:00:00Z'))).toEqual([]);
    expect(listPeriods('nope', new Date())).toEqual([]);
  });

  it('knows its statuses', () => {
    expect(['OPEN', 'CLOSED', 'FILED'].every(isVatPeriodStatus)).toBe(true);
    expect(isVatPeriodStatus('DRAFT')).toBe(false);
  });
});

describe('vatPeriodMachine', () => {
  it('goes OPEN → CLOSED → FILED and reopens only a closed period', () => {
    expect(vatPeriodMachine.next('OPEN', 'close')).toBe('CLOSED');
    expect(vatPeriodMachine.next('CLOSED', 'file')).toBe('FILED');
    expect(vatPeriodMachine.next('CLOSED', 'reopen')).toBe('OPEN');
    expect(() => vatPeriodMachine.next('FILED', 'reopen')).toThrow(InvalidTransitionError);
    expect(() => vatPeriodMachine.next('OPEN', 'file')).toThrow(InvalidTransitionError);
    expect(vatPeriodMachine.events('FILED')).toEqual([]);
  });
});

describe('periodCloseBlockers', () => {
  it('lists only what is pending, in order', () => {
    expect(periodCloseBlockers({ invoicesNotIssued: 0, notesNotIssued: 0, observedPurchases: 0, cancellationsInProgress: 0 })).toEqual([]);
    expect(periodCloseBlockers({ invoicesNotIssued: 2, notesNotIssued: 0, observedPurchases: 1, cancellationsInProgress: 0 })).toEqual([
      { code: 'INVOICES_NOT_ISSUED', count: 2 },
      { code: 'PURCHASES_OBSERVED', count: 1 },
    ]);
    expect(periodCloseBlockers({ invoicesNotIssued: 0, notesNotIssued: 3, observedPurchases: 0, cancellationsInProgress: 1 })).toEqual([
      { code: 'NOTES_NOT_ISSUED', count: 3 },
      { code: 'CANCELLATIONS_IN_PROGRESS', count: 1 },
    ]);
  });
});

describe('canClosePeriod', () => {
  const now = new Date('2026-12-05T12:00:00Z');
  it('refuses a period whose month has not ended', () => {
    expect(canClosePeriod('2026-12', 'OPEN', now, 'CLOSED')).toBe('PERIOD_NOT_ENDED');
    expect(canClosePeriod('2027-01', 'OPEN', now, null)).toBe('PERIOD_NOT_ENDED');
  });
  it('refuses while the previous period is open', () => {
    expect(canClosePeriod('2026-11', 'OPEN', now, 'OPEN')).toBe('PREVIOUS_PERIOD_OPEN');
  });
  it('allows the first period or one after a closed period', () => {
    expect(canClosePeriod('2026-11', 'OPEN', now, null)).toBeNull();
    expect(canClosePeriod('2026-11', 'OPEN', now, 'CLOSED')).toBeNull();
    expect(canClosePeriod('2026-11', 'OPEN', now, 'FILED')).toBeNull();
  });
  it('refuses a period that is not open', () => {
    expect(canClosePeriod('2026-11', 'CLOSED', now, null)).toBe('PERIOD_ALREADY_CLOSED');
  });
});

describe('vatPeriodActions', () => {
  const view = ['invoicing.vat-books.view'];
  const all = ['invoicing.vat-books.view', 'invoicing.vat-books.close'];
  it('needs the view permission', () => {
    expect(vatPeriodActions('OPEN', [])).toEqual([]);
  });
  it('offers by status and permission', () => {
    expect(vatPeriodActions('OPEN', view)).toEqual(['VIEW_BOOKS']);
    expect(vatPeriodActions('OPEN', all)).toEqual(['VIEW_BOOKS', 'CLOSE']);
    expect(vatPeriodActions('CLOSED', all)).toEqual(['VIEW_BOOKS', 'FILE', 'REOPEN']);
    expect(vatPeriodActions('FILED', all)).toEqual(['VIEW_BOOKS']);
  });
});

describe('validateReopenReason', () => {
  it('asks for a reason of reasonable size', () => {
    expect(validateReopenReason(undefined)).toEqual(['REASON_REQUIRED']);
    expect(validateReopenReason('   ')).toEqual(['REASON_REQUIRED']);
    expect(validateReopenReason('corto')).toEqual(['REASON_TOO_SHORT']);
    expect(validateReopenReason('x'.repeat(501))).toEqual(['REASON_TOO_LONG']);
    expect(validateReopenReason('Falta una factura de compra')).toEqual([]);
  });
});
