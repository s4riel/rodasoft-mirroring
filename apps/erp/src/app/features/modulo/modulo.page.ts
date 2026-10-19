import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { NoteComponent, PageHeaderComponent } from '@rodasoft/ui';

/** Marcador de módulo aún no implementado. Recibe título y sprint desde `data` de la ruta. */
@Component({
  selector: 'rs-modulo-page',
  imports: [PageHeaderComponent, NoteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <rs-page-header [title]="titulo()" [breadcrumbs]="[{ label: 'Inicio', link: '/' }, { label: titulo() }]" />
    <rs-note type="warning" [title]="'Llega en ' + sprint()">
      Este módulo se construye según el plan de implementación. El diseño de referencia está en Figma.
    </rs-note>
  `,
})
export class ModuloPage {
  readonly titulo = input('Módulo');
  readonly sprint = input('un próximo sprint');
}
