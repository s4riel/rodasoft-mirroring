import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { NoteComponent, PageHeaderComponent } from '@rodasoft/ui';

/** Placeholder for a module not yet implemented. Receives title and sprint from the route `data`. */
@Component({
  selector: 'rs-module-placeholder-page',
  imports: [PageHeaderComponent, NoteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <rs-page-header [title]="title()" [breadcrumbs]="[{ label: 'Inicio', link: '/' }, { label: title() }]" />
    <rs-note type="warning" [title]="'Llega en ' + sprint()">
      Este módulo se construye según el plan de implementación. El diseño de referencia está en Figma.
    </rs-note>
  `,
})
export class ModulePlaceholderPage {
  readonly title = input('Módulo');
  readonly sprint = input('un próximo sprint');
}
