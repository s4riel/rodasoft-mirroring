import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

export interface SucursalOption {
  id: string;
  nombre: string;
}

export const TODAS_LAS_SUCURSALES = 'all';

/**
 * Barra de contexto (Figma: ContextBar Branch=Single|Multiple|All).
 * La empresa es una etiqueta fija (la define la URL); solo se elige la sucursal.
 * Lado derecho: <div rsContextActions> (búsqueda global, alertas, usuario).
 */
@Component({
  selector: 'rs-context-bar',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ctx">
      <span class="empresa" title="Empresa">{{ empresa() }}</span>
      <span class="sep" aria-hidden="true">/</span>
      @if (sucursales().length > 1 || allowAll()) {
        <label class="sucursal">
          <rs-icon name="branch" [size]="16" />
          <span class="rs-visually-hidden">Sucursal</span>
          <select [value]="sucursalId()" (change)="sucursalId.set($any($event.target).value)">
            @if (allowAll()) {
              <option [value]="all">Todas las sucursales</option>
            }
            @for (s of sucursales(); track s.id) {
              <option [value]="s.id">{{ s.nombre }}</option>
            }
          </select>
          <rs-icon name="chevron-down" [size]="16" />
        </label>
      } @else {
        <span class="sucursal single"><rs-icon name="branch" [size]="16" />{{ single() }}</span>
      }
    </div>
    <div class="actions"><ng-content select="[rsContextActions]" /></div>
  `,
  styles: `
    :host {
      display: flex; align-items: center; justify-content: space-between; gap: var(--space-4);
      height: 64px; padding: 0 var(--space-8); background: var(--bg-surface); border-bottom: 1px solid var(--border-default);
    }
    .ctx { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
    .empresa { font-weight: 700; }
    .sep { color: var(--border-strong); }
    .sucursal { position: relative; display: inline-flex; align-items: center; gap: 6px; color: var(--text-muted); }
    .sucursal select {
      appearance: none; border: 1px solid var(--border-default); background: var(--bg-surface);
      height: 36px; padding: 0 32px 0 var(--space-3); border-radius: var(--radius-full); font-weight: 500; color: var(--text-primary); cursor: pointer;
    }
    .sucursal rs-icon:last-child { position: absolute; right: 10px; pointer-events: none; }
    .single { color: var(--text-primary); font-weight: 500; }
    .actions { display: flex; align-items: center; gap: var(--space-2); }
  `,
})
export class ContextBarComponent {
  readonly empresa = input.required<string>();
  readonly sucursales = input<SucursalOption[]>([]);
  readonly allowAll = input(false);
  readonly sucursalId = model<string>(TODAS_LAS_SUCURSALES);
  protected readonly all = TODAS_LAS_SUCURSALES;
  protected readonly single = computed(() => this.sucursales()[0]?.nombre ?? '—');
}
