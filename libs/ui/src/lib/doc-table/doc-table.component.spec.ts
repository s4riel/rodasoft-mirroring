import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DocTableCellDirective } from './doc-table-cell.directive';
import { DocTableColumn, DocTableComponent, DocTableRow } from './doc-table.component';

const COLUMNS: DocTableColumn[] = [
  { key: 'code', label: 'Código', type: 'code' },
  { key: 'brand', label: 'Marca', type: 'custom' },
  { key: 'stock', label: 'Stock', type: 'number' },
  { key: 'diff', label: 'Diferencia', type: 'status' },
];

const ROWS: DocTableRow[] = [
  { id: 'a', cells: { code: '6205-2RS', stock: 24, diff: { label: 'Original', status: 'idle' } } },
  {
    id: 'b',
    cells: { code: '6205-DDU', stock: 18, diff: { label: 'Sello', status: 'warning', icon: 'alert', tooltip: 'Sello: 2RS → DDU' } },
  },
];

@Component({
  imports: [DocTableComponent, DocTableCellDirective],
  template: `
    <rs-doc-table id="full" size="md" tableLabel="Equivalentes" [columns]="columns" [rows]="rows" [totals]="totals">
      <ng-template rsDocCell="brand" let-row><b class="brand">{{ row.id }}-marca</b></ng-template>
      <div slot="footer" class="foot">1–2 de 2 registros</div>
    </rs-doc-table>
    <rs-doc-table
      id="pick"
      [selectable]="true"
      [(selectedIds)]="picked"
      [maxSelected]="2"
      maxSelectedLabel="Máximo 2 productos"
      selectionHeader="Seleccionar"
      [columns]="columns"
      [rows]="three"
      [totals]="totals"
    />
    <rs-doc-table id="empty" [columns]="columns" [rows]="[]" emptyLabel="Sin equivalentes" />
  `,
})
class HostComponent {
  readonly columns = COLUMNS;
  readonly rows = ROWS;
  readonly totals = { code: 'Total', stock: 42, diff: null };
  readonly three: DocTableRow[] = [
    { id: 'a', label: '6205-2RS', cells: { code: '6205-2RS' } },
    { id: 'b', label: '6205-DDU', cells: { code: '6205-DDU' } },
    { id: 'c', label: '6205-2Z', cells: { code: '6205-2Z' } },
  ];
  picked: readonly string[] = [];
}

describe('DocTableComponent', () => {
  async function render() {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  async function renderPicker() {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const boxes = () => Array.from(el.querySelectorAll<HTMLInputElement>('#pick tbody input[type="checkbox"]'));
    const click = async (i: number) => {
      boxes()[i].click();
      fixture.detectChanges();
      await fixture.whenStable();
    };
    return { fixture, el, boxes, click };
  }

  it('renders the header, a row per item and the table name', async () => {
    const el = await render();
    expect(Array.from(el.querySelectorAll('#full thead th')).map((h) => h.textContent?.trim())).toEqual([
      'Código',
      'Marca',
      'Stock',
      'Diferencia',
    ]);
    expect(el.querySelectorAll('#full tbody tr')).toHaveLength(2);
    expect(el.querySelector('#full table')?.getAttribute('aria-label')).toBe('Equivalentes');
  });

  it('types the cells: code mono, number mono on the right, custom template, status pill', async () => {
    const el = await render();
    const first = el.querySelector('#full tbody tr') as HTMLElement;
    const cells = Array.from(first.querySelectorAll('td'));
    expect(cells[0].classList.contains('code')).toBe(true);
    expect(cells[0].textContent?.trim()).toBe('6205-2RS');
    expect(cells[1].querySelector('.brand')?.textContent).toBe('a-marca');
    expect(cells[2].classList.contains('num')).toBe(true);
    expect(cells[2].textContent?.trim()).toBe('24');
    expect(cells[3].querySelector('rs-status-pill')?.textContent).toContain('Original');
    expect(el.querySelector('#full thead th:nth-child(3)')?.classList.contains('num')).toBe(true);
  });

  it('shows the icon and a focusable tooltip host only on a status with a tooltip', async () => {
    const el = await render();
    const pills = Array.from(el.querySelectorAll('#full rs-status-pill'));
    expect(pills[0].getAttribute('tabindex')).toBeNull();
    expect(pills[1].getAttribute('tabindex')).toBe('0');
    expect(pills[1].querySelector('rs-icon')).not.toBeNull();
    expect(pills[1].getAttribute('data-status')).toBe('warning');
  });

  it('renders the total row and the footer slot, and tags the row size', async () => {
    const el = await render();
    const total = el.querySelector('#full tfoot')?.textContent ?? '';
    expect(total).toContain('Total');
    expect(total).toContain('42');
    expect(el.querySelector('#full tfoot th[scope="row"]')?.textContent?.trim()).toBe('Total');
    expect(el.querySelector('#full .footer .foot')?.textContent).toContain('1–2 de 2 registros');
    expect(el.querySelector('#full')?.getAttribute('data-size')).toBe('md');
    expect(el.querySelector('#empty')?.getAttribute('data-size')).toBe('lg');
  });

  it('shows the empty message and no total row without rows', async () => {
    const el = await render();
    expect(el.querySelector('#empty tbody')?.textContent).toContain('Sin equivalentes');
    expect(el.querySelector('#empty tfoot')).toBeNull();
  });

  describe('selection', () => {
    it('has no checkbox column unless it is selectable', async () => {
      const el = await render();
      expect(el.querySelector('#full input[type="checkbox"]')).toBeNull();
      expect(el.querySelectorAll('#full thead th')).toHaveLength(4);
    });

    it('adds a checkbox per row named after the row, and a hidden header', async () => {
      const { el, boxes } = await renderPicker();
      expect(boxes()).toHaveLength(3);
      expect(Array.from(el.querySelectorAll('#pick tbody .rs-visually-hidden')).map((n) => n.textContent?.trim())).toEqual([
        '6205-2RS',
        '6205-DDU',
        '6205-2Z',
      ]);
      expect(el.querySelector('#pick thead th.select')?.textContent?.trim()).toBe('Seleccionar');
      expect(el.querySelectorAll('#pick tfoot td.select')).toHaveLength(1);
    });

    it('reports the checked ids two-way and marks the row', async () => {
      const { fixture, el, boxes, click } = await renderPicker();
      await click(1);
      await click(0);
      expect(fixture.componentInstance.picked).toEqual(['b', 'a']);
      expect(boxes().map((b) => b.checked)).toEqual([true, true, false]);
      expect(el.querySelectorAll('#pick tbody tr.selected')).toHaveLength(2);
      await click(1);
      expect(fixture.componentInstance.picked).toEqual(['a']);
    });

    it('disables the unchecked rows once the limit is reached and frees them when one is unchecked', async () => {
      const { boxes, click } = await renderPicker();
      await click(0);
      await click(1);
      expect(boxes().map((b) => b.disabled)).toEqual([false, false, true]);
      await click(0);
      expect(boxes().map((b) => b.disabled)).toEqual([false, false, false]);
    });
  });
});
