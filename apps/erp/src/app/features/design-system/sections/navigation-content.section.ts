import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import {
  AccordionComponent,
  ALL_BRANCHES,
  BranchOption,
  BreadcrumbComponent,
  BreadcrumbItem,
  ContextBarComponent,
  NavGroup,
  PageHeaderComponent,
  PaginationComponent,
  PriceRangeComponent,
  PriceRangeValue,
  QtyStepperComponent,
  SidebarComponent,
  StepperComponent,
  StepperStep,
  StepsComponent,
  SubNavComponent,
  SubNavItem,
  TabComponent,
  TabsComponent,
} from '@rodasoft/ui';

/** Showcase "Navigation & content": Tabs, Steps, Breadcrumb, Pagination, QtyStepper, Accordion, PriceRange + ERP shell pieces. */
@Component({
  selector: 'rs-navigation-content-section',
  imports: [
    AccordionComponent,
    BreadcrumbComponent,
    ContextBarComponent,
    PageHeaderComponent,
    PaginationComponent,
    PriceRangeComponent,
    QtyStepperComponent,
    SidebarComponent,
    StepperComponent,
    StepsComponent,
    SubNavComponent,
    TabComponent,
    TabsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="ds-section">
      <h2>Navegación y contenido</h2>

      <h3>Tabs · Active = Productos | Especificaciones | Compatibilidad</h3>
      <div class="stack">
        @for (active of tabValues; track active) {
          <rs-tabs [selected]="active" label="Detalle del producto">
            <rs-tab value="products" label="Productos">Listado de productos relacionados.</rs-tab>
            <rs-tab value="specs" label="Especificaciones">Medidas, tolerancias y materiales.</rs-tab>
            <rs-tab value="compat" label="Compatibilidad">Equivalencias y aplicaciones.</rs-tab>
          </rs-tabs>
        }
        <p class="note">Disabled</p>
        <rs-tabs selected="products" label="Detalle del producto (deshabilitado)">
          <rs-tab value="products" label="Productos">Listado de productos relacionados.</rs-tab>
          <rs-tab value="specs" label="Especificaciones" disabled>Medidas.</rs-tab>
          <rs-tab value="compat" label="Compatibilidad" disabled>Equivalencias.</rs-tab>
        </rs-tabs>
      </div>

      <h3>Steps · Current = 1 | 2 | 3</h3>
      <div class="stack">
        @for (n of [1, 2, 3]; track n) {
          <rs-steps [steps]="checkoutSteps" [current]="n" label="Pasos de compra" />
        }
      </div>

      <h3>Breadcrumb · Levels = 3 | 4</h3>
      <div class="stack">
        <rs-breadcrumb [items]="crumbs3" label="Migas de pan" />
        <rs-breadcrumb [items]="crumbs4" label="Migas de pan" />
        <rs-breadcrumb [items]="crumbs3Disabled" label="Migas de pan (deshabilitado)" />
      </div>

      <h3>Pagination</h3>
      <div class="stack">
        <rs-pagination [(page)]="page" [pageCount]="20" label="Paginación" previousLabel="Página anterior" nextLabel="Página siguiente" />
        <rs-pagination [page]="1" [pageCount]="5" label="Paginación" previousLabel="Página anterior" nextLabel="Página siguiente" />
        <rs-pagination [page]="3" [pageCount]="5" disabled label="Paginación (deshabilitada)" previousLabel="Página anterior" nextLabel="Página siguiente" />
      </div>

      <h3>QtyStepper · Default | Disabled</h3>
      <div class="row">
        <rs-qty-stepper [(value)]="qty" [max]="10" label="Cantidad" decrementLabel="Disminuir cantidad" incrementLabel="Aumentar cantidad" />
        <rs-qty-stepper [value]="1" disabled label="Cantidad" decrementLabel="Disminuir cantidad" incrementLabel="Aumentar cantidad" />
      </div>

      <h3>Accordion · Open = Off | On</h3>
      <div class="stack narrow">
        <rs-accordion title="Envíos y entregas">Entregamos en todo el país en 24 a 72 horas.</rs-accordion>
        <rs-accordion title="Garantía" [open]="true">Seis meses de garantía en todos los rodamientos.</rs-accordion>
        <rs-accordion title="Devoluciones (deshabilitado)" disabled>No disponible.</rs-accordion>
      </div>

      <h3>PriceRange · Default | Disabled</h3>
      <div class="row">
        <rs-price-range
          class="narrow"
          [(value)]="range"
          [min]="0"
          [max]="1000"
          label="Precio"
          lowLabel="Mínimo"
          highLabel="Máximo"
          prefix="Bs"
        />
        <rs-price-range
          class="narrow"
          [value]="fixedRange"
          [min]="0"
          [max]="1000"
          disabled
          label="Precio"
          lowLabel="Mínimo"
          highLabel="Máximo"
          prefix="Bs"
        />
      </div>

      <h2>ERP · Navegación</h2>

      <h3>Sidebar · Current = Inicio (Default, Current, Disabled; Hover y Focus con el puntero y el teclado)</h3>
      <div class="sidebar-frame">
        <rs-sidebar [groups]="navGroups" brandName="Rodalaser" navLabel="Módulos">
          <div rsSidebarFooter class="siat">
            <span class="siat-title"><span class="dot" aria-hidden="true"></span>SIAT en línea</span>
            <span class="siat-sub">CUIS/CUFD vigentes · PROVISIONAL</span>
          </div>
          <p rsSidebarFooter class="version">Entorno de ejemplo · v1.0</p>
        </rs-sidebar>
      </div>

      <h3>ContextBar · Branch = Multiple | All | Single · Disabled</h3>
      <div class="stack">
        <rs-context-bar
          company="Rodalaser S.R.L."
          companyLabel="Empresa"
          branchLabel="Sucursal"
          allLabel="Todas las sucursales"
          description="Empresa definida por la URL&#10;Sucursal según el usuario"
          [branches]="branches"
          branchId="b1"
        />
        <rs-context-bar
          company="Rodalaser S.R.L."
          companyLabel="Empresa"
          branchLabel="Sucursal"
          allLabel="Todas las sucursales"
          description="Empresa definida por la URL&#10;Sucursal según el usuario"
          [branches]="branches"
          allowAll
          [(branchId)]="branchId"
        />
        <rs-context-bar
          company="Rodalaser S.R.L."
          companyLabel="Empresa"
          branchLabel="Sucursal"
          allLabel="Todas las sucursales"
          description="Empresa definida por la URL&#10;Sucursal según el usuario"
          [branches]="[branches[0]]"
          branchId="b1"
        />
        <rs-context-bar
          company="Rodalaser S.R.L."
          companyLabel="Empresa"
          branchLabel="Sucursal"
          allLabel="Todas las sucursales"
          description="Empresa definida por la URL&#10;Sucursal según el usuario"
          [branches]="branches"
          branchId="b1"
          disabled
        />
      </div>

      <h3>PageHeader · List | Detail | Form | ListImport</h3>
      <div class="stack">
        <rs-page-header
          type="list"
          title="Título de la pantalla"
          description="Descripción breve de lo que se hace en esta pantalla."
          breadcrumbLabel="Migas de pan"
          [breadcrumbs]="headerCrumbs"
        >
          <button rsActions type="button" class="btn btn-secondary">Exportar</button>
          <button rsActions type="button" class="btn btn-primary">Nueva venta</button>
        </rs-page-header>
        <rs-page-header
          type="detail"
          title="Venta 000123"
          description="Registrada el 12/03/2026 por Caja 1."
          breadcrumbLabel="Migas de pan"
          [breadcrumbs]="headerCrumbs"
        >
          <span rsStatus class="status"><span class="dot" aria-hidden="true"></span>Pagada</span>
          <button rsActions type="button" class="btn btn-secondary">Imprimir</button>
          <button rsActions type="button" class="btn btn-primary">Anular</button>
        </rs-page-header>
        <rs-page-header
          type="form"
          title="Nuevo producto"
          description="Completa los datos básicos del producto."
          breadcrumbLabel="Migas de pan"
          [breadcrumbs]="headerCrumbs"
        >
          <button rsActions type="button" class="btn btn-secondary">Cancelar</button>
          <button rsActions type="button" class="btn btn-primary">Guardar</button>
        </rs-page-header>
        <rs-page-header
          type="list-import"
          title="Productos"
          description="Catálogo de rodamientos y accesorios."
          breadcrumbLabel="Migas de pan"
          [breadcrumbs]="headerCrumbs"
        >
          <button rsActions type="button" class="btn btn-secondary">Importar</button>
          <button rsActions type="button" class="btn btn-secondary">Exportar</button>
          <button rsActions type="button" class="btn btn-primary">Nuevo producto</button>
        </rs-page-header>
      </div>

      <h3>SubNav · Module = Inventario</h3>
      <rs-sub-nav label="Inventario" [items]="inventoryNav" [(activeKey)]="subNavKey" />
      <rs-sub-nav label="Inventario (con insignia)" [items]="inventoryNavBadge" activeKey="transfers" />

      <h3>Stepper · nuevo producto · Current = 1 … 6</h3>
      <div class="stack">
        @for (n of [1, 2, 3, 4, 5, 6]; track n) {
          <rs-stepper [steps]="stepper6" [current]="n" label="Pasos del nuevo producto" />
        }
      </div>

      <h3>Stepper4 · Current = 1 … 4</h3>
      <div class="stack">
        @for (n of [1, 2, 3, 4]; track n) {
          <rs-stepper [steps]="stepper4" [current]="n" label="Pasos del nuevo producto (4)" />
        }
      </div>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    .ds-section {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    h3 {
      margin-top: var(--space-4);
      color: var(--text-muted);
      font-size: var(--body-md-size);
      line-height: var(--body-md-line-height);
      font-weight: var(--body-md-strong-weight);
    }
    .stack {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-6);
      align-items: flex-start;
    }
    .narrow {
      max-width: 560px;
    }
    rs-price-range.narrow {
      width: 460px;
    }
    .note {
      margin: 0;
      color: var(--text-muted);
      font-size: var(--body-sm-size);
    }
    .sidebar-frame {
      height: 900px;
      width: var(--sidebar-width);
    }
    .siat {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      padding: var(--space-3);
      border-radius: var(--radius-md);
      background: var(--status-success-soft);
    }
    .siat-title {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      font-size: var(--body-md-strong-size);
      line-height: var(--body-md-strong-line-height);
      font-weight: var(--body-md-strong-weight);
      color: var(--text-primary);
    }
    .siat-sub,
    .version {
      margin: 0;
      color: var(--text-muted);
      font-size: var(--body-sm-size);
      line-height: var(--body-sm-line-height);
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: var(--radius-full);
      background: var(--status-success);
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      height: 24px;
      padding: 0 var(--space-3);
      border-radius: var(--radius-full);
      background: var(--status-success-soft);
      color: var(--status-success);
      font-size: var(--body-sm-size);
      font-weight: var(--body-md-strong-weight);
    }
    .status .dot {
      width: 6px;
      height: 6px;
      background: currentColor;
    }
    /* Local stand-ins for the Button component (owned by the actions group), only to show the PageHeader slots. */
    .btn {
      height: var(--size-control-md);
      padding: 0 var(--space-5);
      border-radius: var(--radius-full);
      font-size: var(--label-md-size);
      font-weight: var(--label-md-weight);
      cursor: pointer;
    }
    .btn-secondary {
      border: var(--stroke-default) solid var(--border-control);
      background: var(--bg-surface);
      color: var(--text-primary);
    }
    .btn-primary {
      border: 0;
      background: var(--action-primary);
      color: var(--action-on-primary);
    }
  `,
})
export class NavigationContentSection {
  protected readonly tabValues = ['products', 'specs', 'compat'];
  protected readonly checkoutSteps = ['Carrito', 'Envío', 'Pago'];

  protected readonly crumbs3: BreadcrumbItem[] = [
    { label: 'Inicio', link: '/' },
    { label: 'Productos', link: '/products' },
    { label: 'Rodamientos' },
  ];
  protected readonly crumbs4: BreadcrumbItem[] = [
    { label: 'Inicio', link: '/' },
    { label: 'Productos', link: '/products' },
    { label: 'Rodamientos', link: '/products/bearings' },
    { label: '6204-2RS' },
  ];
  protected readonly crumbs3Disabled: BreadcrumbItem[] = [
    { label: 'Inicio', link: '/', disabled: true },
    { label: 'Productos', link: '/products', disabled: true },
    { label: 'Rodamientos' },
  ];
  protected readonly headerCrumbs: BreadcrumbItem[] = [
    { label: 'Inicio', link: '/' },
    { label: 'Ventas y POS', link: '/sales' },
    { label: 'Ventas realizadas' },
  ];

  protected readonly page = signal(1);
  protected readonly qty = signal(2);
  protected readonly fixedRange: PriceRangeValue = [100, 600];
  protected readonly range = signal<PriceRangeValue | null>([200, 750]);

  protected readonly navGroups: NavGroup[] = [
    {
      label: 'Operación diaria',
      items: [
        { label: 'Inicio', icon: 'home', route: '/', current: true },
        { label: 'Ventas y POS', icon: 'cart', route: '/sales' },
        { label: 'Facturación SIAT', icon: 'invoice', route: '/invoicing' },
        { label: 'Inventario', icon: 'inventory', route: '/inventory' },
        { label: 'Compras', icon: 'purchases', route: '/purchasing' },
      ],
    },
    {
      label: 'Clientes y finanzas',
      items: [
        { label: 'CRM', icon: 'user', route: '/crm' },
        { label: 'Contabilidad', icon: 'accounting', route: '/accounting' },
        { label: 'Reportes', icon: 'reports', route: '/reports' },
      ],
    },
    {
      label: 'Canales y control',
      items: [
        { label: 'Tienda en línea', icon: 'store', route: '/store' },
        { label: 'Configuración', icon: 'settings', route: '/settings', disabled: true },
      ],
    },
  ];

  protected readonly branches: BranchOption[] = [
    { id: 'b1', name: 'Sucursal central (DEMO)' },
    { id: 'b2', name: 'Sucursal norte (DEMO)' },
  ];
  protected readonly branchId = signal<string>(ALL_BRANCHES);

  protected readonly inventoryNav: SubNavItem[] = [
    { key: 'products', label: 'Productos' },
    { key: 'equivalences', label: 'Equivalencias' },
    { key: 'warehouses', label: 'Almacenes' },
    { key: 'transfers', label: 'Transferencias' },
    { key: 'adjustments', label: 'Ajustes' },
    { key: 'kardex', label: 'Kardex' },
  ];
  protected readonly inventoryNavBadge: SubNavItem[] = this.inventoryNav.map((i) =>
    i.key === 'transfers' ? { ...i, badge: 2 } : i,
  );
  protected readonly subNavKey = signal<string | undefined>('products');

  protected readonly stepper6: StepperStep[] = [
    { label: 'Identificación', tag: 'Requerido' },
    { label: 'Dimensiones', tag: 'Requerido' },
    { label: 'Especificaciones', tag: 'Opcional' },
    { label: 'Precio e inventario', tag: 'Requerido' },
    { label: 'Fotos y ficha', tag: 'Opcional' },
    { label: 'Equivalencias', tag: 'Opcional' },
  ];
  protected readonly stepper4: StepperStep[] = this.stepper6.slice(0, 4);
}
