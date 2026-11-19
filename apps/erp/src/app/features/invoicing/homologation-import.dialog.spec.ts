import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { HomologationImportPreview } from '@rodasoft/domain';
import { HomologationImportDialog } from './homologation-import.dialog';

const BASE = '/api/v1/invoicing/homologation/import';

const preview = (over: Partial<HomologationImportPreview> = {}): HomologationImportPreview => ({
  rows: [{ line: 2, sku: 'RL-000001', sinProductCode: '84821', unit: '58', errors: [] }],
  total: 1,
  valid: 1,
  withErrors: 0,
  ...over,
});

describe('HomologationImportDialog (FS-35)', () => {
  let http: HttpTestingController;

  async function render() {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(HomologationImportDialog);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }
  type Fixture = Awaited<ReturnType<typeof render>>;
  const el = (f: Fixture) => f.nativeElement as HTMLElement;
  const apply = (f: Fixture) => el(f).querySelector<HTMLButtonElement>('[data-testid="import-apply"]')!;
  const pick = (f: Fixture) => (f.componentInstance as unknown as { pick(files: File[]): void }).pick([new File(['x'], 'h.xlsx')]);

  afterEach(() => http.verify());

  it('checks the file first and enables the import only when no row has errors', async () => {
    const f = await render();
    expect(apply(f).disabled).toBe(true);
    pick(f);
    http.expectOne(`${BASE}/preview`).flush(preview());
    await f.whenStable();
    f.detectChanges();
    expect(el(f).querySelector('[data-testid="import-ok"]')?.textContent).toContain('1 fila lista');
    expect(apply(f).disabled).toBe(false);
  });

  it('lists the rows with errors and keeps the import disabled', async () => {
    const f = await render();
    pick(f);
    http.expectOne(`${BASE}/preview`).flush(
      preview({ rows: [{ line: 3, sku: 'NOPE', sinProductCode: '00000', unit: '', errors: ['SKU_UNKNOWN', 'SIN_CODE_UNKNOWN'] }], valid: 0, withErrors: 1 }),
    );
    await f.whenStable();
    f.detectChanges();
    const text = el(f).querySelector('[data-testid="import-errors"]')?.textContent ?? '';
    expect(text).toContain('Fila 3');
    expect(text).toContain('El SKU no existe');
    expect(text).toContain('El código SIN no está en el catálogo sincronizado');
    expect(apply(f).disabled).toBe(true);
  });

  it('applies the file, closes and tells the screen', async () => {
    const f = await render();
    const imported = jest.fn();
    f.componentInstance.imported.subscribe(imported);
    pick(f);
    http.expectOne(`${BASE}/preview`).flush(preview());
    await f.whenStable();
    f.detectChanges();
    apply(f).click();
    http.expectOne(BASE).flush({ updated: 1 });
    await f.whenStable();
    expect(imported).toHaveBeenCalled();
    expect(f.componentInstance.open()).toBe(false);
  });

  it('says why the preview failed', async () => {
    const f = await render();
    pick(f);
    http.expectOne(`${BASE}/preview`).flush({ code: 'CATALOGS_NOT_SYNCED', message: 'x' }, { status: 409, statusText: 'Conflict' });
    await f.whenStable();
    f.detectChanges();
    expect(el(f).querySelector('[data-testid="import-error"]')?.textContent).toContain('sincroniza los catálogos');
  });
});
