import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  BearingDiagramComponent,
  ButtonComponent,
  CategoryCardComponent,
  RequestCardComponent,
  IconComponent,
  BranchStockLabels,
  BranchStockRow,
  BranchStockTableComponent,
  DataFieldComponent,
  DocTableCellDirective,
  DocTableColumn,
  DocTableComponent,
  DocTableRow,
  DragHandleComponent,
  KpiCardComponent,
  NumpadComponent,
  PosCartLineComponent,
  PosCustomerComponent,
  PosResultRowComponent,
  QrCodeComponent,
  ReceiptComponent,
  StockFlagComponent,
} from '@rodasoft/ui';

/** Showcase "ERP components": KpiCard, StockFlag and DataField (HU-INV-03). BranchStockTable. PosResultRow and PosCartLine (HU-VEN-02), DragHandle (HU-VEN-33). PosCustomer (HU-VEN-05). Numpad and Receipt (HU-VEN-07, 11). QrCode (HU-VEN-08). */
@Component({
  selector: 'rs-erp-components-section',
  imports: [
    BearingDiagramComponent,
    BranchStockTableComponent,
    ButtonComponent,
    CategoryCardComponent,
    RequestCardComponent,
    DataFieldComponent,
    DocTableCellDirective,
    DocTableComponent,
    DragHandleComponent,
    IconComponent,
    KpiCardComponent,
    NumpadComponent,
    PosCartLineComponent,
    PosCustomerComponent,
    PosResultRowComponent,
    QrCodeComponent,
    ReceiptComponent,
    StockFlagComponent,
  ],
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

      <h3>BearingDiagram (HU-VEN-04, no está en Figma: estimado)</h3>
      <div class="row">
        <rs-bearing-diagram style="width: 10rem; height: 10rem" outerDiameter="52 mm" innerDiameter="25 mm" />
      </div>

      <h3>CategoryCard · State = Default | Selected | Disabled (Hover: CSS, pointer over the card)</h3>
      <div class="row">
        <rs-category-card title="Rodamientos" description="12 subcategorías">
          <rs-icon slot="glyph" name="bearing" [size]="24" />
        </rs-category-card>
        <rs-category-card title="Rodamientos" description="12 subcategorías" [selected]="true">
          <rs-icon slot="glyph" name="bearing" [size]="24" />
        </rs-category-card>
        <rs-category-card title="Rodamientos" description="12 subcategorías" [disabled]="true">
          <rs-icon slot="glyph" name="bearing" [size]="24" />
        </rs-category-card>
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

      <h3>DocTable · Size = Large (72 px) | Medium (52 px), con fila de total y pie</h3>
      <rs-doc-table tableLabel="Ventas" [columns]="docColumns" [rows]="docRows" [totals]="docTotals">
        <ng-template rsDocCell="customer" let-row><strong>{{ row.cells['customer'] }}</strong></ng-template>
        <div slot="footer">1–3 de 3 registros</div>
      </rs-doc-table>
      <rs-doc-table size="md" tableLabel="Equivalentes" [columns]="docColumns" [rows]="docRows.slice(0, 2)" />

      <h3>PosResultRow · Stock = Default | Low | None (con y sin Equivalentes), ShowDetail (Hover: CSS)</h3>
      <div class="pos-list">
        <rs-pos-result-row code="6205-2RS" description="Rodamiento rígido de bolas · SKF" brandInitials="SK" stockLabel="24 en Central" price="Bs 245,00" addLabel="Agregar" showDetail detailLabel="Ver ficha de 6205-2RS" />
        <rs-pos-result-row code="6306-2RS" description="Rodamiento rígido de bolas · NSK" brandInitials="NS" stockLabel="3 en Central" stockLevel="low" price="Bs 380,00" addLabel="Agregar" />
        <rs-pos-result-row code="6208-2RS" description="Rodamiento rígido de bolas · NSK" brandInitials="NS" stockLabel="Agotado aquí" stockLevel="out" price="Bs 410,00" addLabel="Agregar" />
        <rs-pos-result-row code="6208-2RS" description="Rodamiento rígido de bolas · NSK" brandInitials="NS" stockLabel="Agotado aquí" stockLevel="out" price="Bs 410,00" addLabel="Agregar" showDetail detailLabel="Ver ficha de 6208-2RS" showEquivalents equivalentsLabel="Equivalentes" />
      </div>

      <h3>PosCartLine · State = Default | Discount</h3>
      <div class="pos-cart">
        <rs-pos-cart-line title="6205-2RS · SKF" unitPrice="Bs 245,00 c/u" [quantity]="2" [max]="24" total="Bs 490,00" removeLabel="Quitar 6205-2RS" quantityLabel="Cantidad" decrementLabel="Restar uno" incrementLabel="Sumar uno" />
        <rs-pos-cart-line title="6306-2RS · NSK" unitPrice="Bs 380,00 c/u" [quantity]="1" [max]="3" total="Bs 361,00" discountLabel="−5 % · −Bs 19,00" removeLabel="Quitar 6306-2RS" quantityLabel="Cantidad" decrementLabel="Restar uno" incrementLabel="Sumar uno" />
      </div>

      <h3>DragHandle ("Arrastrar ítem" 372:22949: estimated, Figma draws it outside PosCartLine) · default, disabled, and beside a cart line (HU-VEN-33)</h3>
      <div class="pos-cart">
        <rs-drag-handle label="Arrastrar 6205-2RS" />
        <rs-drag-handle label="Arrastrar 6205-2RS (desactivado)" disabled />
      </div>
      <div class="pos-cart drag-line">
        <rs-drag-handle label="Arrastrar 6205-2RS" />
        <rs-pos-cart-line title="6205-2RS · SKF" unitPrice="Bs 245,00 c/u · 25 × 52 × 15 mm · Rodamientos · Rígidos de bolas · Sello: 2RS · Sin existencia" [quantity]="2" [max]="24" total="Bs 490,00" removeLabel="Quitar 6205-2RS" quantityLabel="Cantidad" decrementLabel="Restar uno" incrementLabel="Sumar uno" />
      </div>

      <h3>PosCustomer · Type = Final | Identified</h3>
      <div class="pos-cart">
        <rs-pos-customer type="final" name="Consumidor final" detail="Sin NIT · factura a S/N" actionLabel="Agregar NIT" />
        <rs-pos-customer type="identified" name="Minera Demo Ltda." detail="NIT 1023456027 · compras@minerademo.bo" actionLabel="Cambiar" />
      </div>

      <h3>RequestCard · Tone = Neutral | Negative, with and without actions (VP-25 draws it as plain frames: estimated)</h3>
      <div class="request-cards">
        <rs-request-card
          kicker="Devolución"
          title="DEV-000012 · V-000231"
          description="Ana Cajera · Falla de fábrica · Minera Demo Ltda."
          detail="El cliente trajo el rodamiento roto"
          amount="− Bs 200,00"
          tone="negative"
        >
          <button slot="actions" rsButton variant="ghost" type="button">Rechazar</button>
          <button slot="actions" rsButton variant="primary" type="button">Aprobar</button>
        </rs-request-card>
        <rs-request-card kicker="Diferencia de caja" title="T-0142 · Caja 1" description="Ana Cajera · Cierre con diferencia" amount="− Bs 20,00" tone="negative">
          <button slot="actions" rsButton variant="secondary" type="button">Ver detalle</button>
        </rs-request-card>
        <rs-request-card kicker="Anulación" title="V-000231" description="Ana Cajera · Error de datos del cliente" />
      </div>

      <h3>Numpad · Type = Amount | Qty (Qty estimated: Figma only draws Amount)</h3>
      <div class="row">
        <rs-numpad type="amount" label="Monto recibido" prefix="Bs " value="1200,5" backspaceLabel="Borrar" decimalLabel="Coma decimal" />
        <rs-numpad type="qty" label="Cantidad" value="12" backspaceLabel="Borrar" decimalLabel="Coma decimal" clearLabel="Borrar todo" />
      </div>

      <h3>QrCode · always black on white (not in Figma: estimated)</h3>
      <div class="row">
        <div class="qr-sample"><rs-qr-code payload="RODASOFT-MOCK|demo-ref|490.00" label="Código QR de pago" /></div>
      </div>

      <h3>Receipt · Paper = Ticket 80 mm | Carta (not in Figma: estimated)</h3>
      <div class="row">
        <rs-receipt
          paper="ticket-80mm"
          title="Rodalaser"
          [headerLines]="['Rodalaser S.R.L.', 'NIT 1020304050', 'Sucursal central']"
          [metaRows]="[{ label: 'Comprobante', value: 'V-000125' }, { label: 'Fecha', value: '14/10/2026 10:42' }, { label: 'Cliente', value: 'S/N' }]"
          [items]="[{ description: '6205-2RS · Rodamiento rígido de bolas', detail: '2 × Bs 245,00', total: 'Bs 490,00' }]"
          [totalRows]="[{ label: 'Total', value: 'Bs 490,00', strong: true }, { label: 'Efectivo recibido', value: 'Bs 500,00' }, { label: 'Cambio', value: 'Bs 10,00' }]"
          [footerLines]="['Factura pendiente de emisión', 'Gracias por su compra.']"
        />
      </div>
    </section>
  `,
  styles: `
    .row { display: flex; flex-wrap: wrap; gap: var(--space-4); align-items: flex-start; }
    .qr-sample { width: 12rem; } /* showcase size of the sample QR, no token */
    .row > rs-kpi-card { width: 400px; }
    .row > rs-data-field { width: 280px; }
    .row > rs-data-field[data-layout="inline"] { width: 440px; }
    .pos-list { max-width: 760px; border: var(--stroke-default) solid var(--border-default); border-radius: var(--radius-lg); overflow: hidden; }
    .pos-cart { width: 420px; }
    .drag-line { display: flex; align-items: center; gap: var(--space-2); }
    .drag-line rs-pos-cart-line { flex: 1 1 0; min-width: 0; }
    .request-cards { display: grid; gap: var(--space-3); max-width: 720px; }
  `,
})
export class ErpComponentsSection {
  protected readonly docColumns: DocTableColumn[] = [
    { key: 'number', label: 'N.º', type: 'code' },
    { key: 'customer', label: 'Cliente', type: 'custom' },
    { key: 'items', label: 'Ítems', type: 'number' },
    { key: 'total', label: 'Total', type: 'number' },
    { key: 'status', label: 'Estado', type: 'status' },
  ];
  protected readonly docRows: DocTableRow[] = [
    { id: '124', cells: { number: '000124', customer: 'Industrias Demo S.A.', items: 8, total: 'Bs 1.280,00', status: { label: 'Pagada', status: 'success', icon: 'check' } } },
    { id: '123', cells: { number: '000123', customer: 'Cliente mostrador', items: 2, total: 'Bs 640,00', status: { label: 'Pagada', status: 'success', icon: 'check' } } },
    { id: '122', cells: { number: '000122', customer: 'Minera Demo Ltda.', items: 15, total: 'Bs 2.950,00', status: { label: 'Por cobrar', status: 'warning', icon: 'alert', tooltip: 'Vence el 20/10/2026' } } },
  ];
  protected readonly docTotals = { number: 'Total', customer: '3 ventas', items: 25, total: 'Bs 4.870,00', status: null };

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
