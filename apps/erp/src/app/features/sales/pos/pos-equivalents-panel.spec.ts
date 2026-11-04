import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { PosEquivalentItem, PosEquivalentsResponse } from '@rodasoft/domain';
import { PosEquivalentsPanel } from './pos-equivalents-panel';

const URL = '/api/v1/sales/pos/products/p-orig/equivalents';

const item = (over: Partial<PosEquivalentItem> = {}): PosEquivalentItem => ({
  productId: 'e1',
  code: '6208-2RSR',
  name: 'Rodamiento 6208-2RSR',
  brand: { name: 'NTN', initials: 'NT' },
  salePrice: '245.00',
  available: 8,
  kind: 'EXACT',
  differences: [],
  substitute: false,
  notes: null,
  measures: { innerDiameter: '40', outerDiameter: '80', width: '18' },
  ...over,
});

const response = (over: Partial<PosEquivalentsResponse> = {}): PosEquivalentsResponse => ({
  original: { id: 'p-orig', code: '6208-2RS', available: 0 },
  warehouse: { id: 'w1', name: 'Central' },
  items: [item()],
  otherBranches: [],
  ...over,
});

describe('PosEquivalentsPanel', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<PosEquivalentsPanel>;

  function open(adding: string[] = []) {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(PosEquivalentsPanel);
    fixture.componentRef.setInput('productId', 'p-orig');
    fixture.componentRef.setInput('code', '6208-2RS');
    fixture.componentRef.setInput('warehouseName', 'Central');
    fixture.componentRef.setInput('adding', new Set(adding));
    fixture.detectChanges();
  }

  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => root().textContent ?? '';
  const rows = () => Array.from(root().querySelectorAll<HTMLElement>('rs-pos-result-row'));
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const answer = async (res: PosEquivalentsResponse) => {
    http.expectOne(URL).flush(res);
    await settle();
  };

  afterEach(() => http.verify());

  it('asks for the equivalents when it appears and shows a skeleton meanwhile', () => {
    open();
    expect(root().querySelector('[aria-busy=true]')).not.toBeNull();
    expect(text()).toContain('Sin stock de 6208-2RS en Central · equivalentes disponibles');
    http.expectOne(URL).flush(response());
  });

  it('shows an exact equivalent as "Exacta · d × D × B · Marca" with its stock, price and Agregar', async () => {
    open();
    await answer(response());
    expect(rows()).toHaveLength(1);
    const row = rows()[0];
    expect(row.textContent).toContain('6208-2RSR');
    expect(row.textContent).toContain('Exacta · 40 × 80 × 18 · NTN');
    expect(row.textContent).toContain('8 en Central');
    expect(row.textContent).toContain('Bs 245,00');
    expect(row.querySelector('button')?.textContent).toContain('Agregar');
  });

  it('shows the cashier note of an equivalent with differences', async () => {
    open();
    await answer(
      response({
        items: [
          item({
            kind: 'WITH_DIFFERENCES',
            notes: 'blindaje metálico en vez de sello',
            differences: [{ key: 'seal', label: 'Sello', source: '2RS', other: '2Z' }],
            brand: { name: 'FAG', initials: 'FA' },
          }),
        ],
      }),
    );
    expect(rows()[0].textContent).toContain('Con diferencias · blindaje metálico en vez de sello · FAG');
  });

  it('falls back to the first two differences when there is no note, and marks a substitute', async () => {
    open();
    const d = (key: string, label: string, source: string | null, other: string | null) => ({ key, label, source, other });
    await answer(
      response({
        items: [
          item({
            kind: 'WITH_DIFFERENCES',
            substitute: true,
            differences: [d('seal', 'Sello', '2RS', '2Z'), d('cage', 'Jaula', null, 'Acero'), d('dynamicLoad', 'Carga dinámica', '1', '2')],
          }),
        ],
      }),
    );
    const line = rows()[0].textContent ?? '';
    expect(line).toContain('Sustituto · Con diferencias · Sello: 2RS → 2Z, Jaula: — → Acero · NTN');
    expect(line).not.toContain('Carga dinámica');
  });

  it('emits the equivalent when Agregar is pressed', async () => {
    open();
    await answer(response({ items: [item(), item({ productId: 'e2', code: '6208-DDU' })] }));
    const added: PosEquivalentItem[] = [];
    fixture.componentInstance.add.subscribe((i) => added.push(i));
    rows()[1].querySelector<HTMLButtonElement>('button')!.click();
    expect(added.map((i) => i.productId)).toEqual(['e2']);
  });

  it('disables Agregar of the equivalent being added', async () => {
    open(['e1']);
    await answer(response());
    expect(rows()[0].querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
  });

  it('lists the stock of the original in other branches below the rows', async () => {
    open();
    await answer(response({ otherBranches: [{ branchName: 'Sacaba', available: 4 }, { branchName: 'Panamericana', available: 2 }] }));
    expect(text()).toContain('6208-2RS en otras sucursales: Sacaba 4 uds · Panamericana 2 uds');
  });

  it('says no equivalent has stock, and still shows the other branches', async () => {
    open();
    await answer(response({ items: [], otherBranches: [{ branchName: 'Sacaba', available: 4 }] }));
    expect(rows()).toHaveLength(0);
    expect(text()).toContain('Ningún equivalente tiene stock en Central');
    expect(text()).toContain('6208-2RS en otras sucursales: Sacaba 4 uds');
  });

  it('hides the other-branches line when the original is in stock nowhere else', async () => {
    open();
    await answer(response());
    expect(text()).not.toContain('en otras sucursales');
  });

  it('says so, without a retry, when the user may not see the equivalents', async () => {
    open();
    http.expectOne(URL).flush({ code: 'NO_PERMISSION', message: 'no' }, { status: 403, statusText: 'Forbidden' });
    await settle();
    expect(text()).toContain('No tienes permiso para ver los equivalentes');
    expect(Array.from(root().querySelectorAll('button')).some((b) => b.textContent?.includes('Reintentar'))).toBe(false);
  });

  it('shows the error state, reports the failure and retries', async () => {
    open();
    const failures: unknown[] = [];
    fixture.componentInstance.loadFailed.subscribe((e) => failures.push(e));
    http.expectOne(URL).flush({ code: 'X', message: 'boom' }, { status: 500, statusText: 'Server Error' });
    await settle();
    expect(text()).toContain('No pudimos cargar los equivalentes');
    expect(failures).toHaveLength(1);

    Array.from(root().querySelectorAll('button')).find((b) => b.textContent?.includes('Reintentar'))!.click();
    await answer(response());
    expect(rows()).toHaveLength(1);
  });
});
