import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NoteComponent, PageHeaderComponent } from '@rodasoft/ui';
import { AuthService } from '../../core/auth/auth.service';
import { ContextStore } from '../../core/context.store';

/** BC-05 a/b · Home. The real indicators arrive with Sales, Invoicing and Inventory. */
@Component({
  selector: 'rs-home-page',
  imports: [PageHeaderComponent, NoteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <rs-page-header [title]="greeting()" [subtitle]="subtitle()" />
    <rs-note type="info" title="Base común lista">
      Acceso, empresa por URL, sucursales y permisos funcionando. Los módulos se activan sprint a sprint.
    </rs-note>
    <section class="grid" aria-label="Resumen">
      @for (k of kpis; track k.label) {
        <article class="rs-card kpi">
          <p class="rs-eyebrow">{{ k.label }}</p>
          <p class="value">—</p>
          <p class="rs-muted">{{ k.hint }}</p>
        </article>
      }
    </section>
  `,
  styles: `
    rs-note { margin-bottom: var(--space-6); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--space-4); }
    .kpi { padding: var(--space-5); display: grid; gap: var(--space-2); border-radius: var(--radius-lg); }
    .value { font-size: 28px; font-weight: 700; letter-spacing: var(--tracking-tight); }
  `,
})
export class HomePage {
  private readonly auth = inject(AuthService);
  private readonly ctx = inject(ContextStore);

  protected readonly kpis = [
    { label: 'Ventas de hoy', hint: 'Disponible en S2 (Ventas y POS)' },
    { label: 'Facturas emitidas', hint: 'Disponible en S2 (SIAT)' },
    { label: 'Productos bajo el mínimo', hint: 'Disponible en S1 (Inventario)' },
    { label: 'Transferencias por recibir', hint: 'Disponible en S1 (Inventario)' },
  ];

  protected readonly greeting = computed(() => {
    const h = new Date().getHours();
    const s = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
    const firstName = this.auth.user()?.name?.split(' ')[0];
    return firstName ? `${s}, ${firstName}` : s;
  });

  protected readonly subtitle = computed(() => {
    const branch = this.ctx.currentBranch()?.name ?? 'Todas las sucursales';
    return `${this.ctx.company()?.tradeName ?? ''} · ${branch}`;
  });
}
