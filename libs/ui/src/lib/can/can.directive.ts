import { Directive, effect, inject, InjectionToken, input, Signal, TemplateRef, ViewContainerRef } from '@angular/core';

/** La app provee los permisos del usuario actual (del endpoint /contexto). */
export const RS_PERMISSIONS = new InjectionToken<Signal<ReadonlySet<string>>>('RS_PERMISSIONS');

/**
 * Muestra el contenido solo si el usuario tiene TODOS los permisos.
 *   <button *rsCan="'ventas.anulaciones.aprobar'">Aprobar</button>
 *   <section *rsCan="['inventario.costos.ver', 'reportes.ver']">…</section>
 * Es solo UX: el backend vuelve a validar con @RequirePermissions().
 */
@Directive({ selector: '[rsCan]' })
export class CanDirective {
  readonly rsCan = input.required<string | string[]>();
  private readonly permissions = inject(RS_PERMISSIONS);
  private readonly tpl = inject(TemplateRef);
  private readonly vcr = inject(ViewContainerRef);
  private shown = false;

  constructor() {
    effect(() => {
      const required = ([] as string[]).concat(this.rsCan());
      const granted = this.permissions();
      const ok = required.every((p) => granted.has(p));
      if (ok && !this.shown) {
        this.vcr.createEmbeddedView(this.tpl);
        this.shown = true;
      } else if (!ok && this.shown) {
        this.vcr.clear();
        this.shown = false;
      }
    });
  }
}
