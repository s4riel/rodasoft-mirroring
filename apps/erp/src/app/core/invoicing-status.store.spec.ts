import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { InvoicingStatus } from '@rodasoft/domain';
import { ToastService } from '@rodasoft/ui';
import { INVOICING_STATUS_POLL_MS, InvoicingStatusStore } from './invoicing-status.store';

const URL = '/api/v1/invoicing/status';
const status = (over: Partial<InvoicingStatus> = {}): InvoicingStatus => ({ connection: 'ONLINE', checkedAt: null, notIssued: 0, rejected: 0, ...over });

describe('InvoicingStatusStore', () => {
  let http: HttpTestingController;
  let store: InvoicingStatusStore;
  let toast: ToastService;

  beforeEach(() => {
    jest.useFakeTimers();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(InvoicingStatusStore);
    toast = TestBed.inject(ToastService);
  });

  afterEach(() => {
    store.stop();
    http.verify();
    jest.useRealTimers();
  });

  it('loads at once and then polls every minute', () => {
    store.start();
    store.start(); // idempotent
    http.expectOne(URL).flush(status());
    expect(store.status()?.connection).toBe('ONLINE');
    jest.advanceTimersByTime(INVOICING_STATUS_POLL_MS);
    http.expectOne(URL).flush(status({ connection: 'OFFLINE', notIssued: 2 }));
    expect(store.status()?.notIssued).toBe(2);
  });

  it('tells when the SIAT is back online with the invoices left unissued', () => {
    store.start();
    http.expectOne(URL).flush(status({ connection: 'OFFLINE', notIssued: 3 }));
    expect(toast.toasts()).toHaveLength(0);
    store.refresh();
    http.expectOne(URL).flush(status({ connection: 'ONLINE', notIssued: 3 }));
    expect(toast.toasts()).toHaveLength(1);
    expect(toast.toasts()[0].message).toContain('El SIAT volvió a estar en línea · 3 facturas sin emitir');
  });

  it('does not toast on the first load nor when it was already online', () => {
    store.start();
    http.expectOne(URL).flush(status());
    store.refresh();
    http.expectOne(URL).flush(status());
    expect(toast.toasts()).toHaveLength(0);
  });

  it('keeps the last known state through a transient failure', () => {
    store.start();
    http.expectOne(URL).flush(status({ connection: 'OFFLINE' }));
    store.refresh();
    http.expectOne(URL).flush('x', { status: 500, statusText: 'Server Error' });
    expect(store.status()?.connection).toBe('OFFLINE');
  });

  it('keeps no status when the user may not see invoicing (403)', () => {
    store.start();
    http.expectOne(URL).flush({ code: 'NO_PERMISSION' }, { status: 403, statusText: 'Forbidden' });
    expect(store.status()).toBeNull();
    // and it stops asking
    jest.advanceTimersByTime(INVOICING_STATUS_POLL_MS * 2);
    http.expectNone(URL);
  });
});
