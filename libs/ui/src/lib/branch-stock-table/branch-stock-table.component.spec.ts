import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BranchStockLabels, BranchStockRow, BranchStockTableComponent } from './branch-stock-table.component';

const LABELS: BranchStockLabels = {
  branch: 'Sucursal',
  warehouse: 'Almacén',
  available: 'Disponible',
  min: 'Mínimo',
  status: 'Estado',
  availability: { available: 'Disponible', low: 'Stock bajo', out: 'Agotado' },
  empty: 'Sin sucursales',
};

const ROWS: BranchStockRow[] = [
  { id: 'a', branch: 'Central', warehouse: 'Almacén principal', available: 24, minStock: 10, availability: 'available', current: true },
  { id: 'b', branch: 'Sur', warehouse: 'Almacén Sur', available: 6, minStock: 10, availability: 'low', current: false },
  { id: 'c', branch: 'Norte', warehouse: 'Almacén Norte', available: 0, minStock: null, availability: 'out', current: false },
];

@Component({
  imports: [BranchStockTableComponent],
  template: `
    <rs-branch-stock-table
      id="full"
      tableLabel="Stock por sucursal"
      totalLabel="Total · 3 sucursales"
      [rows]="rows"
      [labels]="labels"
      [totalAvailable]="30"
      [totalMin]="20"
    />
    <rs-branch-stock-table id="empty" totalLabel="Total · 0 sucursales" [rows]="[]" [labels]="labels" [totalAvailable]="0" />
  `,
})
class HostComponent {
  readonly rows = ROWS;
  readonly labels = LABELS;
}

describe('BranchStockTableComponent', () => {
  async function render() {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the Figma columns and a row per branch with warehouse, available and minimum', async () => {
    const el = await render();
    const headers = Array.from(el.querySelectorAll('#full thead th')).map((h) => h.textContent?.trim());
    expect(headers).toEqual(['Sucursal', 'Almacén', 'Disponible', 'Mínimo', 'Estado']);
    const rows = Array.from(el.querySelectorAll('#full tbody tr'));
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('Almacén principal');
    expect(rows[0].textContent).toContain('24');
    expect(rows[2].textContent).toContain('–');
    expect(el.querySelector('#full table')?.getAttribute('aria-label')).toBe('Stock por sucursal');
  });

  it('shows the status as a pill with glyph and text, never color alone', async () => {
    const el = await render();
    const status = Array.from(el.querySelectorAll<HTMLElement>('#full .status'));
    expect(status.map((s) => s.textContent?.trim())).toEqual(['Disponible', 'Stock bajo', 'Agotado']);
    expect(status.map((s) => s.getAttribute('data-availability'))).toEqual(['available', 'low', 'out']);
    expect(status.every((s) => s.querySelector('rs-icon'))).toBe(true);
  });

  it('highlights only the current branch', async () => {
    const el = await render();
    const rows = Array.from(el.querySelectorAll('#full tbody tr'));
    expect(rows.map((r) => r.classList.contains('current'))).toEqual([true, false, false]);
    expect(rows[0].getAttribute('aria-current')).toBe('true');
    expect(rows[1].getAttribute('aria-current')).toBeNull();
  });

  it('ends with the total row', async () => {
    const el = await render();
    const total = el.querySelector('#full tfoot')?.textContent ?? '';
    expect(total).toContain('Total · 3 sucursales');
    expect(total).toContain('30');
    expect(total).toContain('20');
  });

  it('shows the empty message when there are no branches', async () => {
    const el = await render();
    expect(el.querySelector('#empty tbody')?.textContent).toContain('Sin sucursales');
  });
});
