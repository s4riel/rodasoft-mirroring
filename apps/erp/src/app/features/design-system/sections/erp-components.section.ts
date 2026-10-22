import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  BranchStockLabels,
  BranchStockRow,
  BranchStockTableComponent,
  DataFieldComponent,
  KpiCardComponent,
  StockFlagComponent,
} from '@rodasoft/ui';

/** Showcase "ERP components": KpiCard, StockFlag and DataField (HU-INV-03). BranchStockTable. */
@Component({
  selector: 'rs-erp-components-section',
  imports: [BranchStockTableComponent, DataFieldComponent, KpiCardComponent, StockFlagComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="ds-section">
      <h2>Componentes ERP</h2>

      <h3>KpiCard · Trend = Positive | Negative | Neutral, State = Default | Disabled (Focus: tab)</h3>
      <div class="row">
        <rs-kpi-card label="Ventas del mes" value="Bs 128.450,00" trend="positive" note="+12% vs. mes anterior" />
        <rs-kpi-card label="Ventas del mes" value="Bs 128.450,00" trend="negative" note="−8% vs. mes anterior" />
        <rs-kpi-card label="Ventas del mes" value="Bs 128.450,00" trend="neutral" note="Sin cambios vs. mes anterior" />
        <rs-kpi-card label="Ventas del mes" value="Bs 128.450,00" trend="positive" note="+12% vs. mes anterior" disabled />
        <rs-kpi-card label="Ventas del mes" value="Bs 128.450,00" trend="positive" note="+12% vs. mes anterior" tabindex="0" />
      </div>

      <h3>StockFlag · Level = Low | Out</h3>
      <div class="row">
        <rs-stock-flag level="low" label="Stock bajo" />
        <rs-stock-flag level="out" label="Agotado" />
      </div>

      <h3>DataField · Layout = Stacked | Inline, Type = Text | Mono | Empty</h3>
      <div class="row">
        <rs-data-field label="Código" icon="barcode" type="mono">6205-2RS</rs-data-field>
        <rs-data-field label="Diámetro interior d" icon="diameter" type="mono">25 mm</rs-data-field>
        <rs-data-field label="Sello" icon="tag">2RS</rs-data-field>
        <rs-data-field label="Proveedor" icon="info" type="empty" />
        <rs-data-field label="Código" icon="barcode" layout="inline" type="mono">6205-2RS</rs-data-field>
      </div>

      <h3>BranchStockTable</h3>
      <rs-branch-stock-table
        tableLabel="Stock por sucursal"
        totalLabel="Total · 4 sucursales"
        [rows]="rows"
        [labels]="labels"
        [totalAvailable]="48"
        [totalMin]="36"
      />
    </section>
  `,
  styles: `
    .row { display: flex; flex-wrap: wrap; gap: var(--space-4); align-items: flex-start; }
    .row > rs-kpi-card { width: 400px; }
    .row > rs-data-field { width: 280px; }
    .row > rs-data-field[data-layout="inline"] { width: 440px; }
  `,
})
export class ErpComponentsSection {
  protected readonly labels: BranchStockLabels = {
    branch: 'Sucursal',
    warehouse: 'Almacén',
    available: 'Disponible',
    min: 'Mínimo',
    status: 'Estado',
    availability: { available: 'Disponible', low: 'Stock bajo', out: 'Agotado' },
    empty: 'Sin sucursales',
  };
  protected readonly rows: BranchStockRow[] = [
    { id: 'a', branch: 'Central', warehouse: 'Almacén principal', available: 24, minStock: 10, availability: 'available', current: true },
    { id: 'b', branch: 'Sucursal Sur', warehouse: 'Almacén Sur', available: 6, minStock: 10, availability: 'low', current: false },
    { id: 'c', branch: 'Sucursal Norte', warehouse: 'Almacén Norte', available: 0, minStock: 8, availability: 'out', current: false },
    { id: 'd', branch: 'Sucursal Este', warehouse: 'Almacén Este', available: 18, minStock: 8, availability: 'available', current: false },
  ];
}
