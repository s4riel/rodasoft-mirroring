import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { TransferResolveResponse } from '@rodasoft/domain';
import { TransferListAddition, TransferListDialog, TransferListMode } from './transfer-list.dialog';

@Component({
  imports: [TransferListDialog],
  template: `<rs-transfer-list-dialog [(open)]="open" [mode]="mode()" warehouseId="w1" (added)="added.set($event)" />`,
})
class Host {
  readonly open = signal(true);
  readonly mode = signal<TransferListMode>('file');
  readonly added = signal<TransferListAddition[]>([]);
}

const RESOLVED: TransferResolveResponse = {
  lines: [
    { line: 2, code: '6204', quantity: 3, group: 'RECOGNIZED', product: { id: 'p1', sku: 's', manufacturerCode: '6204', name: 'Rodamiento', brand: 'SKF' }, available: 9, unitCost: null },
    { line: 3, code: 'OFF', quantity: 1, group: 'INACTIVE', product: { id: 'p2', sku: 's2', manufacturerCode: 'OFF', name: 'Viejo', brand: 'SKF' }, available: 0, unitCost: null },
  ],
  errors: [{ line: 4, reason: 'INVALID_QUANTITY', text: '6205,0' }],
  counts: { RECOGNIZED: 1, INSUFFICIENT_STOCK: 0, NOT_FOUND: 0, INACTIVE: 1 },
};

describe('TransferListDialog (Excel / CSV)', () => {
  let http: HttpTestingController;

  function setup() {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return fixture;
  }
  const el = () => document.body.textContent ?? '';
  const modalButton = (label: string) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('rs-modal button')).find((b) => b.textContent?.includes(label));

  afterEach(() => http.verify());

  it('refuses a file that is neither .xlsx nor .csv before calling the API', () => {
    const fixture = setup();
    const dialog = fixture.debugElement.children[0].componentInstance as unknown as { onFiles(files: File[]): void };
    dialog.onFiles([new File(['x'], 'lista.pdf')]);
    fixture.detectChanges();
    expect(el()).toContain('Solo se aceptan archivos .xlsx o .csv.');
    expect(modalButton('Revisar')?.disabled).toBe(true);
  });

  it('sends the file with the origin warehouse, shows the read lines and adds only the recognized ones', async () => {
    const fixture = setup();
    const dialog = fixture.debugElement.children[0].componentInstance as unknown as { onFiles(files: File[]): void };
    dialog.onFiles([new File(['6204,3'], 'lista.csv', { type: 'text/csv' })]);
    fixture.detectChanges();

    modalButton('Revisar')?.click();
    const req = http.expectOne('/api/v1/inventory/transfers/resolve-lines');
    const body = req.request.body as FormData;
    expect(body.get('warehouseId')).toBe('w1');
    expect((body.get('file') as File).name).toBe('lista.csv');
    req.flush(RESOLVED);
    fixture.detectChanges();

    expect(el()).toContain('Reconocidos');
    expect(el()).toContain('Producto inactivo');
    expect(el()).toContain('Línea 4: La cantidad debe ser un entero mayor que 0');

    modalButton('Agregar 1 producto')?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.added()).toEqual([expect.objectContaining({ quantity: 3, product: expect.objectContaining({ id: 'p1', available: 9 }) })]);
    expect(fixture.componentInstance.open()).toBe(false);
  });

  it('shows the server error in Spanish and stays on the first step', () => {
    const fixture = setup();
    const dialog = fixture.debugElement.children[0].componentInstance as unknown as { onFiles(files: File[]): void };
    dialog.onFiles([new File(['x'], 'lista.xlsx')]);
    fixture.detectChanges();
    modalButton('Revisar')?.click();
    http.expectOne('/api/v1/inventory/transfers/resolve-lines').flush({ code: 'FILE_INVALID', message: 'x' }, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();
    expect(el()).toContain('No pudimos leer el archivo');
    expect(modalButton('Revisar')).toBeDefined();
  });

  it('offers nothing to add when no line was recognized', () => {
    const fixture = setup();
    fixture.componentInstance.mode.set('paste');
    fixture.detectChanges();
    const area = document.querySelector<HTMLTextAreaElement>('#transfer-paste') as HTMLTextAreaElement;
    area.value = 'NOPE,1';
    area.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    modalButton('Revisar')?.click();
    http.expectOne('/api/v1/inventory/transfers/resolve-lines').flush({
      lines: [{ line: 1, code: 'NOPE', quantity: 1, group: 'NOT_FOUND', product: null, available: null, unitCost: null }],
      errors: [],
      counts: { RECOGNIZED: 0, INSUFFICIENT_STOCK: 0, NOT_FOUND: 1, INACTIVE: 0 },
    } satisfies TransferResolveResponse);
    fixture.detectChanges();
    expect(el()).toContain('No hay productos para agregar');
    expect(modalButton('Agregar 0 productos')?.disabled).toBe(true);
  });
});
