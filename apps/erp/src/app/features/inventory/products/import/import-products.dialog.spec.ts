import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ImportCommitResponse, ImportPreviewResponse, ImportPreviewRow } from '@rodasoft/domain';
import { ImportProductsDialog } from './import-products.dialog';

const PREVIEW_URL = '/api/v1/inventory/products/import/preview';
const COMMIT_URL = '/api/v1/inventory/products/import/commit';
const ERRORS_URL = '/api/v1/inventory/products/import/error-report';
const TEMPLATE_URL = '/api/v1/inventory/products/import/template';

const row = (over: Partial<ImportPreviewRow> = {}): ImportPreviewRow => ({
  rowNumber: 2,
  code: '6205-2RS',
  brand: 'SKF',
  status: 'valid',
  action: 'create',
  errors: [],
  warnings: [],
  ...over,
});

const preview = (rows: ImportPreviewRow[], over: Partial<ImportPreviewResponse['summary']> = {}): ImportPreviewResponse => ({
  mode: 'create_only',
  rows,
  unknownColumns: [],
  summary: {
    total: rows.length,
    valid: rows.filter((r) => r.status === 'valid').length,
    withError: rows.filter((r) => r.status === 'error').length,
    withWarning: rows.filter((r) => r.warnings.length > 0).length,
    toCreate: rows.filter((r) => r.status === 'valid' && r.action === 'create').length,
    toUpdate: rows.filter((r) => r.status === 'valid' && r.action === 'update').length,
    pieces: 0,
    value: '0.00',
    ...over,
  },
});

const MIXED = preview([
  row({ rowNumber: 2 }),
  row({ rowNumber: 3, code: '6206', brand: 'Nueva', status: 'error', errors: [{ field: 'brand', code: 'BRAND_NOT_FOUND' }] }),
  row({
    rowNumber: 4,
    code: '6207',
    action: 'update',
    warnings: [{ field: 'Stock HK-01', code: 'STOCK_WILL_ADJUST', params: { warehouse: 'HK-01', from: 10, to: 25 } }],
  }),
]);

const xlsx = (name = 'productos.xlsx', size = 2048) => new File([new Uint8Array(size)], name);

@Component({
  imports: [ImportProductsDialog],
  template: `<rs-import-products-dialog [(open)]="open" (imported)="imported.set($event)" />`,
})
class HostComponent {
  readonly open = signal(true);
  readonly imported = signal<ImportCommitResponse | null>(null);
}

describe('ImportProductsDialog', () => {
  let http: HttpTestingController;

  async function setup() {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const buttons = () => Array.from(el.querySelectorAll<HTMLButtonElement>('button'));
    const button = (label: string) => buttons().find((b) => b.textContent?.includes(label));
    const pick = async (file: File) => {
      const input = el.querySelector<HTMLInputElement>('input[type=file]')!;
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change'));
      await fixture.whenStable();
    };
    const review = async (body: ImportPreviewResponse = MIXED) => {
      await pick(xlsx());
      button('Revisar')!.click();
      await fixture.whenStable();
      http.expectOne(PREVIEW_URL).flush(body);
      await fixture.whenStable();
    };
    const text = () => el.textContent ?? '';
    return { fixture, el, button, pick, review, text, host: fixture.componentInstance };
  }

  afterEach(() => {
    http.verify();
    jest.restoreAllMocks();
  });

  describe('IN-21a · upload', () => {
    it('asks for the file and the mode, and cannot review without a file', async () => {
      const { text, button } = await setup();
      expect(text()).toContain('Importar productos');
      expect(text()).toContain('Arrastra tu archivo aquí');
      expect(text()).toContain('Descargar plantilla');
      expect(text()).toContain('Solo crear nuevos');
      expect(text()).toContain('Crear y actualizar existentes');
      expect(button('Revisar')!.disabled).toBe(true);
    });

    it('accepts only .xlsx files', async () => {
      const { text, pick, button } = await setup();
      await pick(xlsx('productos.csv'));
      expect(text()).toContain('Solo se aceptan archivos Excel (.xlsx).');
      expect(button('Revisar')!.disabled).toBe(true);
    });

    it('refuses a file over 5 MB', async () => {
      const { text, pick } = await setup();
      await pick(xlsx('grande.xlsx', 5 * 1024 * 1024 + 1));
      expect(text()).toContain('El archivo supera el límite de 5 MB.');
    });

    it('shows the picked file, lets the user remove it and enables Revisar', async () => {
      const { text, pick, button, fixture, el } = await setup();
      await pick(xlsx());
      expect(text()).toContain('productos.xlsx');
      expect(button('Revisar')!.disabled).toBe(false);

      el.querySelector<HTMLButtonElement>('rs-file-item button')!.click();
      await fixture.whenStable();
      expect(text()).not.toContain('productos.xlsx');
      expect(button('Revisar')!.disabled).toBe(true);
    });

    it('sends the file with the chosen mode to the preview', async () => {
      const { pick, button, fixture, el } = await setup();
      await pick(xlsx());
      el.querySelectorAll<HTMLElement>('rs-radio-card')[1].click();
      await fixture.whenStable();
      button('Revisar')!.click();
      await fixture.whenStable();

      const req = http.expectOne(PREVIEW_URL);
      const body = req.request.body as FormData;
      expect(body.get('mode')).toBe('create_or_update');
      expect((body.get('file') as File).name).toBe('productos.xlsx');
      req.flush(MIXED);
    });

    it('asks the server for the template', async () => {
      const { button } = await setup();
      URL.createObjectURL = jest.fn(() => 'blob:template');
      URL.revokeObjectURL = jest.fn();
      jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
      button('Descargar plantilla')!.click();
      const req = http.expectOne(TEMPLATE_URL);
      expect(req.request.responseType).toBe('blob');
      req.flush(new Blob(['x']));
      expect(URL.createObjectURL).toHaveBeenCalled();
    });

    it('explains a file without the required columns', async () => {
      const { pick, button, fixture, text } = await setup();
      await pick(xlsx());
      button('Revisar')!.click();
      await fixture.whenStable();
      http
        .expectOne(PREVIEW_URL)
        .flush({ code: 'IMPORT_INVALID_TEMPLATE', message: 'x', details: { missing: ['Marca'] } }, { status: 422, statusText: 'Unprocessable' });
      await fixture.whenStable();
      expect(text()).toContain('Faltan columnas obligatorias: Marca.');
      expect(text()).toContain('Importar productos');
    });
  });

  describe('IN-21b · preview', () => {
    it('shows the counters, every row with its status and the Spanish messages', async () => {
      const { review, text } = await setup();
      await review();
      const t = text();
      expect(t).toContain('Revisa la importación');
      for (const label of ['Válidas', 'Con error', 'Con advertencia', 'Nuevas', 'A actualizar']) expect(t).toContain(label);
      expect(t).toContain('6205-2RS');
      expect(t).toContain('Marca no existe');
      expect(t).toContain('Ajustará el stock de 10 a 25');
      expect(t).toContain('Error');
      expect(t).toContain('Advertencia');
      expect(t).toContain('Solo se importarán las filas válidas.');
      expect(t).toContain('Importar 2 productos');
    });

    it('filters the rows by error and by warning', async () => {
      const { review, el, fixture } = await setup();
      await review();
      const chip = (label: string) =>
        Array.from(el.querySelectorAll<HTMLButtonElement>('rs-filter-chip button')).find((c) => c.textContent?.includes(label))!;
      const codes = () => Array.from(el.querySelectorAll('rs-doc-table tbody tr td.code')).map((c) => c.textContent?.trim());

      expect(codes()).toEqual(['6205-2RS', '6206', '6207']);
      chip('Con error').click();
      await fixture.whenStable();
      expect(codes()).toEqual(['6206']);
      chip('Con advertencia').click();
      await fixture.whenStable();
      expect(codes()).toEqual(['6207']);
    });

    it('pages the rows by 10', async () => {
      const { review, el, text } = await setup();
      await review(preview(Array.from({ length: 12 }, (_, i) => row({ rowNumber: i + 2, code: `C-${i + 1}` }))));
      expect(el.querySelectorAll('rs-doc-table tbody tr')).toHaveLength(10);
      expect(text()).toContain('Mostrando 1–10 de 12');
    });

    it('cannot import when no row is valid, and still offers the error report', async () => {
      const { review, button, text } = await setup();
      await review(preview([row({ status: 'error', errors: [{ field: 'brand', code: 'BRAND_NOT_FOUND' }] })]));
      expect(button('Importar 0 productos')!.disabled).toBe(true);
      expect(text()).toContain('No hay filas válidas');
      expect(button('Descargar errores')).toBeDefined();
    });

    it('downloads the error report with the same file and mode', async () => {
      const { review, button } = await setup();
      URL.createObjectURL = jest.fn(() => 'blob:errors');
      URL.revokeObjectURL = jest.fn();
      jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
      await review();
      button('Descargar errores')!.click();
      const req = http.expectOne(ERRORS_URL);
      expect((req.request.body as FormData).get('mode')).toBe('create_only');
      req.flush(new Blob(['x']));
      expect(URL.createObjectURL).toHaveBeenCalled();
    });

    it('goes back to the upload step keeping the file', async () => {
      const { review, button, text, fixture } = await setup();
      await review();
      button('Volver')!.click();
      await fixture.whenStable();
      expect(text()).toContain('Arrastra tu archivo aquí');
    });

    it('imports the valid rows, closes and reports the result', async () => {
      const { review, button, fixture, host, text } = await setup();
      await review();
      button('Importar 2 productos')!.click();
      await fixture.whenStable();

      const req = http.expectOne(COMMIT_URL);
      expect((req.request.body as FormData).get('mode')).toBe('create_only');
      req.flush({ created: 1, updated: 1, skipped: 1, stockMovements: 0 });
      await fixture.whenStable();

      expect(host.open()).toBe(false);
      expect(host.imported()).toEqual({ created: 1, updated: 1, skipped: 1, stockMovements: 0 });
      expect(text()).not.toContain('Revisa la importación');
    });

    it('keeps the preview open and explains when the server refuses', async () => {
      const { review, button, fixture, host, text } = await setup();
      await review();
      button('Importar 2 productos')!.click();
      await fixture.whenStable();
      http
        .expectOne(COMMIT_URL)
        .flush({ code: 'NO_PERMISSION', message: 'x', details: { missing: ['inventory.adjustments.create'] } }, { status: 403, statusText: 'Forbidden' });
      await fixture.whenStable();

      expect(host.open()).toBe(true);
      expect(text()).toContain('necesitas el permiso de ajustes de inventario');
    });
  });
});
