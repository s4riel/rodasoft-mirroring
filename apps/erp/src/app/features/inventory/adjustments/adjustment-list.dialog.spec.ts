import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AdjustmentResolveResponse } from '@rodasoft/domain';
import type { AdjustmentAddition } from './adjustment-lines';
import { AdjustmentListDialog, AdjustmentListMode } from './adjustment-list.dialog';

const URL = '/api/v1/inventory/adjustments/resolve-lines';

@Component({
  imports: [AdjustmentListDialog],
  template: `<rs-adjustment-list-dialog [(open)]="open" [mode]="mode()" warehouseId="w1" (added)="added.set($event)" />`,
})
class Host {
  readonly open = signal(true);
  readonly mode = signal<AdjustmentListMode>('paste');
  readonly added = signal<AdjustmentAddition[]>([]);
}

const RESOLVED: AdjustmentResolveResponse = {
  lines: [
    { line: 1, code: '6204', quantity: 3, kind: 'OUT', group: 'RECOGNIZED', product: { id: 'p1', sku: 's', manufacturerCode: '6204', name: 'Rodamiento', brand: 'SKF' }, available: 9, unitCost: '5.0000' },
    { line: 2, code: '6205', quantity: 12, kind: 'IN', group: 'RECOGNIZED', product: { id: 'p2', sku: 's2', manufacturerCode: '6205', name: 'Sello', brand: 'SKF' }, available: 1, unitCost: null },
    { line: 3, code: 'OFF', quantity: 1, kind: 'OUT', group: 'INACTIVE', product: { id: 'p3', sku: 's3', manufacturerCode: 'OFF', name: 'Viejo', brand: 'SKF' }, available: 0, unitCost: null },
  ],
  errors: [{ line: 4, reason: 'INVALID_KIND', text: '6206,1,Cambio' }],
  counts: { RECOGNIZED: 2, INSUFFICIENT_STOCK: 0, NOT_FOUND: 0, INACTIVE: 1 },
};

describe('AdjustmentListDialog', () => {
  let http: HttpTestingController;

  function setup(mode: AdjustmentListMode = 'paste') {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.mode.set(mode);
    fixture.detectChanges();
    return fixture;
  }
  const el = () => document.body.textContent ?? '';
  const modalButton = (label: string) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('rs-modal button')).find((b) => b.textContent?.includes(label));
  const dialog = (fixture: ReturnType<typeof setup>) => fixture.debugElement.children[0].componentInstance as unknown as { onFiles(files: File[]): void };

  function paste(fixture: ReturnType<typeof setup>, text: string) {
    const area = document.querySelector<HTMLTextAreaElement>('#adjustment-paste') as HTMLTextAreaElement;
    area.value = text;
    area.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  afterEach(() => http.verify());

  it('explains the optional kind and keeps "Revisar" disabled until something is pasted', () => {
    const fixture = setup();
    expect(el()).toContain('Entrada, Salida o Conteo');
    expect(modalButton('Revisar')?.disabled).toBe(true);
    paste(fixture, 'A-1, 2');
    expect(modalButton('Revisar')?.disabled).toBe(false);
  });

  it('sends the pasted text with the warehouse, shows what was read and adds only the recognized lines with their kind', () => {
    const fixture = setup();
    paste(fixture, '6204, 3\n6205, 12, Entrada');
    modalButton('Revisar')?.click();
    const req = http.expectOne(URL);
    expect(req.request.body).toEqual({ warehouseId: 'w1', text: '6204, 3\n6205, 12, Entrada' });
    req.flush(RESOLVED);
    fixture.detectChanges();

    expect(el()).toContain('Reconocidos');
    expect(el()).toContain('Producto inactivo');
    expect(el()).toContain('Entrada');
    expect(el()).toContain('Línea 4: El tipo debe ser Entrada, Salida o Conteo');

    modalButton('Agregar 2 productos')?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.added()).toEqual([
      expect.objectContaining({ kind: 'OUT', quantity: 3, product: expect.objectContaining({ id: 'p1', available: 9, unitCost: '5.0000' }) }),
      expect.objectContaining({ kind: 'IN', quantity: 12, product: expect.objectContaining({ id: 'p2', available: 1 }) }),
    ]);
    expect(fixture.componentInstance.open()).toBe(false);
  });

  it('refuses a file that is neither .xlsx nor .csv before calling the API', () => {
    const fixture = setup('file');
    dialog(fixture).onFiles([new File(['x'], 'lista.pdf')]);
    fixture.detectChanges();
    expect(el()).toContain('Solo se aceptan archivos .xlsx o .csv.');
    expect(modalButton('Revisar')?.disabled).toBe(true);
  });

  it('sends an uploaded file as form data with the warehouse', () => {
    const fixture = setup('file');
    dialog(fixture).onFiles([new File(['6204,3'], 'lista.csv', { type: 'text/csv' })]);
    fixture.detectChanges();
    modalButton('Revisar')?.click();
    const req = http.expectOne(URL);
    const body = req.request.body as FormData;
    expect(body.get('warehouseId')).toBe('w1');
    expect((body.get('file') as File).name).toBe('lista.csv');
    req.flush(RESOLVED);
    fixture.detectChanges();
    expect(el()).toContain('Revisa la lista');
  });

  it('shows the server error in Spanish and stays on the first step', () => {
    const fixture = setup();
    paste(fixture, 'A-1, 1');
    modalButton('Revisar')?.click();
    http.expectOne(URL).flush({ code: 'TOO_MANY_LINES', message: 'x' }, { status: 422, statusText: 'Unprocessable Entity' });
    fixture.detectChanges();
    expect(el()).toContain('Un ajuste admite hasta 200 productos.');
    expect(modalButton('Revisar')).toBeDefined();
  });

  it('offers nothing to add when no line was recognized', () => {
    const fixture = setup();
    paste(fixture, 'NOPE, 1');
    modalButton('Revisar')?.click();
    http.expectOne(URL).flush({
      lines: [{ line: 1, code: 'NOPE', quantity: 1, kind: 'OUT', group: 'NOT_FOUND', product: null, available: null, unitCost: null }],
      errors: [],
      counts: { RECOGNIZED: 0, INSUFFICIENT_STOCK: 0, NOT_FOUND: 1, INACTIVE: 0 },
    } satisfies AdjustmentResolveResponse);
    fixture.detectChanges();
    expect(el()).toContain('No hay productos para agregar');
    expect(modalButton('Agregar 0 productos')?.disabled).toBe(true);
  });
});
