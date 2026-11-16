import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { ContextStore } from '../../core/context.store';
import { InvoicingLayoutPage } from './invoicing-layout.page';
import { canSeeInvoicingTab, INVOICING_TABS } from './invoicing-tabs';

@Component({ template: '<p>contenido</p>' })
class Child {}

describe('invoicing tabs', () => {
  it('shows each tab to who holds its permission, and has no contingency tab', () => {
    const can = (granted: string[]) => (p: string) => granted.includes(p);
    expect(INVOICING_TABS.filter((t) => canSeeInvoicingTab(t, can(['invoicing.invoices.view']))).map((t) => t.key)).toEqual(['invoices', 'notes', 'status']);
    expect(INVOICING_TABS.filter((t) => canSeeInvoicingTab(t, can(['invoicing.vat-books.view']))).map((t) => t.key)).toEqual(['books']);
    expect(INVOICING_TABS.map((t) => t.key)).not.toContain('contingency');
  });
});

describe('InvoicingLayoutPage', () => {
  async function open(granted: string[]) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'invoicing', component: InvoicingLayoutPage, children: [{ path: '', component: Child }] }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(new Set(granted)) },
      ],
    });
    // the layout reads permissions through the context store
    jest.spyOn(TestBed.inject(ContextStore), 'can').mockImplementation((p: string) => granted.includes(p));
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/invoicing', InvoicingLayoutPage);
    harness.detectChanges();
    return harness.routeNativeElement as HTMLElement;
  }

  it('shows the sub-navigation with the tabs of the user, and the active child', async () => {
    const root = await open(['invoicing.invoices.view', 'invoicing.vat-books.view']);
    const text = root.textContent ?? '';
    for (const label of ['Facturas', 'Notas de crédito', 'Estado del sistema', 'Libros IVA']) expect(text).toContain(label);
    expect(text).toContain('contenido');
  });

  it('leaves out the books tab for who cannot see the books', async () => {
    const root = await open(['invoicing.invoices.view']);
    expect(root.textContent).not.toContain('Libros IVA');
  });
});
