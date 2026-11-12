import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ApprovalsCountStore } from './approvals-count.store';

describe('ApprovalsCountStore (HU-VEN-29)', () => {
  function setup() {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    return { store: TestBed.inject(ApprovalsCountStore), http: TestBed.inject(HttpTestingController) };
  }

  it('has no figure until the first answer', () => {
    expect(setup().store.pending()).toBeNull();
  });

  it('reads the count of requests that wait', () => {
    const { store, http } = setup();
    store.refresh();
    http.expectOne('/api/v1/sales/approvals/summary').flush({ pending: 4 });
    expect(store.pending()).toBe(4);
    http.verify();
  });

  it('drops the figure when the read fails instead of showing a wrong one', () => {
    const { store, http } = setup();
    store.set(4);
    store.refresh();
    http.expectOne('/api/v1/sales/approvals/summary').flush({ code: 'ERROR', message: 'x' }, { status: 500, statusText: 'Server Error' });
    expect(store.pending()).toBeNull();
    http.verify();
  });

  it('takes the figure of the inbox, which already holds it', () => {
    const { store } = setup();
    store.set(2);
    expect(store.pending()).toBe(2);
  });
});
