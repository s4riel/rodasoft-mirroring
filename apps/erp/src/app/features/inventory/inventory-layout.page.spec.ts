import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ContextStore } from '../../core/context.store';
import { InventoryLayoutPage } from './inventory-layout.page';

const COUNT_URL = '/api/v1/inventory/transfers/open-count';
/** The count is read after a zero-delay debounce, so the startup triggers become one request. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

@Component({ template: '' })
class StubPage {}

describe('InventoryLayoutPage', () => {
  let http: HttpTestingController;

  async function open(granted: string[]) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: 'inventory',
            component: InventoryLayoutPage,
            children: [
              { path: 'products', component: StubPage },
              { path: 'transfers', component: StubPage },
            ],
          },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ContextStore, useValue: { can: (p: string) => granted.includes(p), permissions: signal(new Set(granted)) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/inventory/products', InventoryLayoutPage);
    await tick();
    return harness;
  }

  const badge = (h: RouterTestingHarness) => (h.routeNativeElement as HTMLElement).querySelector('rs-sub-nav .badge, rs-sub-nav [class*="badge"]');
  const tabsText = (h: RouterTestingHarness) => (h.routeNativeElement as HTMLElement).querySelector('rs-sub-nav')?.textContent ?? '';

  afterEach(() => http.verify());

  it('shows how many transfers are open on the Transferencias tab', async () => {
    const h = await open(['inventory.transfers.create']);
    http.expectOne(COUNT_URL).flush({ count: 2 });
    h.detectChanges();
    expect(tabsText(h)).toMatch(/Transferencias\s*2/);
  });

  it('shows no badge when nothing is open', async () => {
    const h = await open(['inventory.transfers.create']);
    http.expectOne(COUNT_URL).flush({ count: 0 });
    h.detectChanges();
    expect(tabsText(h)).not.toMatch(/Transferencias\s*\d/);
    expect(badge(h)).toBeNull();
  });

  it('reads the count again after every navigation, since a send or a receipt changes it', async () => {
    const h = await open(['inventory.transfers.create']);
    http.expectOne(COUNT_URL).flush({ count: 1 });
    await TestBed.inject(Router).navigateByUrl('/inventory/transfers');
    await tick();
    http.expectOne(COUNT_URL).flush({ count: 3 });
    h.detectChanges();
    expect(tabsText(h)).toMatch(/Transferencias\s*3/);
  });

  it('does not ask for the count without a transfer permission', async () => {
    const h = await open(['inventory.products.view']);
    http.expectNone(COUNT_URL);
    expect(tabsText(h)).toContain('Transferencias');
  });

  it('shows the Kardex tab, linked to the kardex, only with inventory.kardex.view', async () => {
    const h = await open(['inventory.kardex.view']);
    h.detectChanges();
    expect(tabsText(h)).toContain('Kardex');
    expect((h.routeNativeElement as HTMLElement).querySelector('rs-sub-nav a[href="/inventory/kardex"]')).not.toBeNull();
  });

  it('hides the Kardex tab without inventory.kardex.view', async () => {
    const h = await open(['inventory.products.view']);
    h.detectChanges();
    expect(tabsText(h)).not.toContain('Kardex');
  });

  it('keeps the tab and drops the badge when the count cannot be read', async () => {
    const h = await open(['inventory.transfers.create']);
    http.expectOne(COUNT_URL).flush({ code: 'ERROR', message: 'x' }, { status: 500, statusText: 'Server Error' });
    h.detectChanges();
    expect(tabsText(h)).toContain('Transferencias');
    expect(tabsText(h)).not.toMatch(/Transferencias\s*\d/);
  });
});
