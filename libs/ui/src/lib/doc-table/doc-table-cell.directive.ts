import { Directive, inject, input, TemplateRef } from '@angular/core';
import { DocTableRow } from './doc-table.component';

/** Template of a `custom` column: `<ng-template rsDocCell="brand" let-row>…</ng-template>` inside `<rs-doc-table>`. */
@Directive({ selector: 'ng-template[rsDocCell]' })
export class DocTableCellDirective {
  readonly key = input.required<string>({ alias: 'rsDocCell' });
  readonly template = inject<TemplateRef<{ $implicit: DocTableRow }>>(TemplateRef);
}
