import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  AvatarComponent,
  BadgeComponent,
  ButtonComponent,
  ChipMediaComponent,
  EmptyStateComponent,
  EmptyStateIllustratedComponent,
  FieldMediaComponent,
  FilterChipComponent,
  FLAG_COUNTRIES,
  FlagComponent,
  IconComponent,
  IllustrationComponent,
  ILLUSTRATION_NAMES,
  ModalComponent,
  NoteComponent,
  RadioCardComponent,
  RadioCardGroupComponent,
  SkeletonComponent,
  StatusPillComponent,
  ToastComponent,
  ToastOutletComponent,
  ToastService,
  TooltipComponent,
  TooltipDirective,
} from '@rodasoft/ui';

/** Showcase of the "Selection & feedback" group, in the same grouping as the Figma frames (page 02 Base Components). */
@Component({
  selector: 'rs-selection-feedback-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AvatarComponent,
    BadgeComponent,
    ButtonComponent,
    ChipMediaComponent,
    EmptyStateComponent,
    EmptyStateIllustratedComponent,
    FieldMediaComponent,
    FilterChipComponent,
    FlagComponent,
    IconComponent,
    IllustrationComponent,
    ModalComponent,
    NoteComponent,
    RadioCardComponent,
    RadioCardGroupComponent,
    SkeletonComponent,
    StatusPillComponent,
    ToastComponent,
    ToastOutletComponent,
    TooltipComponent,
    TooltipDirective,
  ],
  template: `
    <section class="group">
      <h2>Selección y retroalimentación</h2>

      <h3 class="rs-eyebrow">FilterChip · Size M / L × Selected Off / On</h3>
      <div class="matrix">
        @for (size of sizes; track size) {
          @for (selected of [false, true]; track selected) {
            <div class="row">
              <span class="tag">{{ size.toUpperCase() }} · {{ selected ? 'On' : 'Off' }}</span>
              <rs-filter-chip [size]="size" [selected]="selected" label="Alemania">
                <rs-chip-media type="flag" country="DE" />
              </rs-filter-chip>
              <rs-filter-chip [size]="size" [selected]="selected" label="SKF">
                <rs-chip-media type="brand" text="SKF" />
              </rs-filter-chip>
              <rs-filter-chip [size]="size" [selected]="selected" label="Sin medio" [showMedia]="false" />
              <rs-filter-chip [size]="size" [selected]="selected" label="Deshabilitado" [disabled]="true">
                <rs-chip-media type="initials" text="RA" />
              </rs-filter-chip>
            </div>
          }
        }
        <p class="hint">Hover, Pressed y Focus se ven al interactuar (solo CSS). Prueba con el teclado.</p>
        <div class="row">
          <span class="tag">Interactivo</span>
          <rs-filter-chip [(selected)]="chipA" label="Bolivia"><rs-chip-media type="flag" country="BO" /></rs-filter-chip>
          <rs-filter-chip [(selected)]="chipB" label="En stock"><rs-chip-media type="count" text="12" /></rs-filter-chip>
        </div>
      </div>

      <h3 class="rs-eyebrow">ChipMedia · 28 px</h3>
      <div class="row">
        <rs-chip-media type="flag" country="DE" />
        <rs-chip-media type="brand" text="SKF" />
        <rs-chip-media type="icon"><rs-icon name="store" [size]="20" /></rs-chip-media>
        <rs-chip-media type="initials" text="RA" />
        <rs-chip-media type="count" text="12" />
      </div>

      <h3 class="rs-eyebrow">FieldMedia · 24 px</h3>
      <div class="row">
        <rs-field-media type="flag" country="BO" />
        <rs-field-media type="brand" text="SKF" />
      </div>

      <h3 class="rs-eyebrow">Flag · 20×14</h3>
      <div class="row">
        @for (country of countries; track country) {
          <span class="flag-cell"><rs-flag [country]="country" /><small>{{ country }}</small></span>
        }
      </div>

      <h3 class="rs-eyebrow">RadioCard · Checked On / Off × State</h3>
      <div class="cards">
        <rs-radio-card-group [(value)]="shipping">
          <rs-radio-card value="pickup" label="Retiro en sucursal" description="Gratis · listo en 2 horas" />
          <rs-radio-card value="delivery" label="Envío a domicilio" description="Entrega en 24 a 48 horas" />
          <rs-radio-card value="locked" label="Envío internacional" description="No disponible" [disabled]="true" />
        </rs-radio-card-group>
        <rs-radio-card label="Suelta, marcada" description="Checked = On, sin grupo" [checked]="true" />
        <rs-radio-card label="Suelta, deshabilitada" description="Disabled" [disabled]="true" />
      </div>

      <h3 class="rs-eyebrow">StatusPill · Status</h3>
      <div class="row">
        <rs-status-pill status="success">Vigente</rs-status-pill>
        <rs-status-pill status="warning">Por vencer</rs-status-pill>
        <rs-status-pill status="danger">Rechazada</rs-status-pill>
        <rs-status-pill status="info">En proceso</rs-status-pill>
        <rs-status-pill status="idle">Sin configurar</rs-status-pill>
      </div>

      <h3 class="rs-eyebrow">Note · Type</h3>
      <div class="stack">
        <rs-note type="info" title="Información">El inventario se sincroniza cada 15 minutos.</rs-note>
        <rs-note type="success" title="Listo">La factura se emitió correctamente.</rs-note>
        <rs-note type="warning" title="Atención">El CUFD vence en 2 horas.</rs-note>
        <rs-note type="danger" title="Error">No se pudo conectar con el SIAT.</rs-note>
        <rs-note type="info">Nota sin título.</rs-note>
      </div>

      <h3 class="rs-eyebrow">Toast · Type</h3>
      <div class="stack">
        <rs-toast type="info" heading="Información" [dismissible]="false">Se actualizó el tipo de cambio.</rs-toast>
        <rs-toast type="success" heading="Guardado" [dismissible]="false">Los cambios se guardaron.</rs-toast>
        <rs-toast type="warning" heading="Atención" [dismissible]="false">Stock bajo en 3 productos.</rs-toast>
        <rs-toast type="danger" heading="Error" closeLabel="Cerrar">No se pudo guardar el documento.</rs-toast>
      </div>
      <div class="row">
        <button rsButton variant="secondary" size="sm" (click)="toast.success('Los cambios se guardaron.', { heading: 'Guardado' })">Mostrar éxito</button>
        <button rsButton variant="secondary" size="sm" (click)="toast.danger('No se pudo guardar el documento.', { heading: 'Error', duration: 0 })">Mostrar error fijo</button>
        <button rsButton variant="ghost" size="sm" (click)="toast.clear()">Limpiar</button>
      </div>
      <rs-toast-outlet closeLabel="Cerrar" />

      <h3 class="rs-eyebrow">Tooltip</h3>
      <div class="row">
        <rs-tooltip text="Copiar código" />
        <button rsButton variant="secondary" size="sm" rsTooltip="Arriba (por defecto)">Arriba</button>
        <button rsButton variant="secondary" size="sm" rsTooltip="Debajo" rsTooltipPosition="bottom">Abajo</button>
        <button rsButton variant="secondary" size="sm" rsTooltip="A la izquierda" rsTooltipPosition="left">Izquierda</button>
        <button rsButton variant="secondary" size="sm" rsTooltip="A la derecha" rsTooltipPosition="right">Derecha</button>
      </div>

      <h3 class="rs-eyebrow">Modal · Confirmation / Form</h3>
      <div class="row">
        <button rsButton variant="secondary" (click)="confirmOpen.set(true)">Abrir confirmación</button>
        <button rsButton variant="secondary" (click)="formOpen.set(true)">Abrir formulario</button>
      </div>
      <rs-modal [(open)]="confirmOpen" variant="confirmation" heading="¿Anular la factura?" closeLabel="Cerrar">
        Esta acción envía la solicitud de anulación al SIAT y no se puede deshacer.
        <div slot="footer">
          <button rsButton variant="secondary" (click)="confirmOpen.set(false)">Cancelar</button>
          <button rsButton variant="danger" (click)="confirmOpen.set(false)">Anular</button>
        </div>
      </rs-modal>
      <rs-modal [(open)]="formOpen" variant="form" heading="Nuevo contacto" closeLabel="Cerrar">
        <label class="field">Nombre<input class="input" type="text" placeholder="Nombre completo" /></label>
        <label class="field">Correo<input class="input" type="email" placeholder="correo@empresa.com" /></label>
        <div slot="footer">
          <button rsButton variant="secondary" (click)="formOpen.set(false)">Cancelar</button>
          <button rsButton variant="primary" (click)="formOpen.set(false)">Guardar</button>
        </div>
      </rs-modal>

      <h3 class="rs-eyebrow">EmptyState</h3>
      <div class="panel">
        <rs-empty-state heading="Aún no hay clientes" description="Crea el primero para empezar a vender.">
          <rs-icon slot="icon" name="search" [size]="24" />
          <button rsButton variant="primary" size="sm">Nuevo cliente</button>
        </rs-empty-state>
      </div>

      <h3 class="rs-eyebrow">EmptyState/Illustrated · Size Page / Inline × ShowAction</h3>
      <div class="panel">
        <rs-empty-state-illustrated size="page" illustration="no-results" heading="Sin resultados" description="Prueba con otro código o quita algunos filtros.">
          <button rsButton variant="secondary" size="sm">Limpiar filtros</button>
        </rs-empty-state-illustrated>
      </div>
      <div class="panel">
        <rs-empty-state-illustrated size="inline" illustration="empty-cart" heading="Tu carrito está vacío" description="Agrega productos para cotizar." [showAction]="false">
          <button rsButton variant="primary" size="sm">Ver catálogo</button>
        </rs-empty-state-illustrated>
      </div>

      <h3 class="rs-eyebrow">Illustration · 240×180</h3>
      <div class="illustrations">
        @for (name of illustrationNames; track name) {
          <figure>
            <rs-illustration [name]="name" />
            <figcaption>{{ name }}</figcaption>
          </figure>
        }
      </div>

      <h3 class="rs-eyebrow">Skeleton</h3>
      <div class="skeletons">
        <rs-skeleton shape="circle" width="40px" height="40px" />
        <div class="lines">
          <rs-skeleton shape="text" width="60%" height="14px" />
          <rs-skeleton shape="text" width="90%" height="12px" />
          <rs-skeleton shape="text" width="40%" height="12px" />
        </div>
        <rs-skeleton shape="rect" width="160px" height="96px" />
      </div>

      <h3 class="rs-eyebrow">Avatar · Type × Size</h3>
      <div class="row">
        <rs-avatar size="sm" initials="RA" name="Rosa Aguilar" />
        <rs-avatar size="md" initials="RA" name="Rosa Aguilar" />
        <rs-avatar size="sm" src="data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'%3E%3Crect width='8' height='8' fill='lightgray'/%3E%3C/svg%3E" name="Imagen" />
        <rs-avatar size="md" src="data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'%3E%3Crect width='8' height='8' fill='lightgray'/%3E%3C/svg%3E" name="Imagen" />
      </div>

      <h3 class="rs-eyebrow">Badge · New / Offer / OutOfStock</h3>
      <div class="row">
        <rs-badge variant="new">Nuevo</rs-badge>
        <rs-badge variant="offer">Oferta</rs-badge>
        <rs-badge variant="out-of-stock">Agotado</rs-badge>
      </div>
    </section>
  `,
  styles: `
    :host { display: block; }
    .group { display: grid; gap: var(--space-4); }
    h3 { margin-top: var(--space-6); }
    .row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
    .matrix { display: grid; gap: var(--space-3); }
    .tag { min-width: 88px; color: var(--text-muted); font-size: var(--body-sm-size); }
    .hint { color: var(--text-muted); font-size: var(--body-sm-size); }
    .flag-cell { display: inline-flex; flex-direction: column; align-items: center; gap: var(--space-1); color: var(--text-muted); }
    .cards { display: grid; gap: var(--space-3); max-width: 420px; }
    .stack { display: grid; gap: var(--space-3); max-width: 480px; }
    .panel { background: var(--bg-surface); border: var(--stroke-default) solid var(--border-default); border-radius: var(--radius-xl); }
    .illustrations { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: var(--space-4); }
    figure { margin: 0; display: grid; justify-items: center; gap: var(--space-2); }
    figcaption { color: var(--text-muted); font-size: var(--body-sm-size); }
    .skeletons { display: flex; align-items: center; gap: var(--space-4); max-width: 560px; }
    .lines { flex: 1; display: grid; gap: var(--space-2); }
    .field { display: grid; gap: var(--space-1); margin-bottom: var(--space-3); font-weight: 500; color: var(--text-primary); }
    .input { height: var(--size-control-md); padding: 0 var(--space-3); border: var(--stroke-default) solid var(--border-control); border-radius: var(--radius-md); background: var(--bg-surface); }
  `,
})
export class SelectionFeedbackSection {
  protected readonly toast = inject(ToastService);

  protected readonly sizes = ['m', 'l'] as const;
  protected readonly countries = FLAG_COUNTRIES;
  protected readonly illustrationNames = ILLUSTRATION_NAMES;

  protected readonly chipA = signal(true);
  protected readonly chipB = signal(false);
  protected readonly shipping = signal<unknown>('pickup');
  protected readonly confirmOpen = signal(false);
  protected readonly formOpen = signal(false);
}
