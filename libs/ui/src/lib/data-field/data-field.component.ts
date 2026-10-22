import { booleanAttribute, ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { IconName } from '../icon/icons';

export type DataFieldLayout = 'stacked' | 'inline';
export type DataFieldType = 'text' | 'mono' | 'empty';

/**
 * Figma: DataField Layout=Stacked|Inline, Type=Text|Mono|Empty, ShowIcon, Icon, Label, Value.
 * Read-only label + value for sheets and details (not a form control: use Field to edit). The value is the
 * default slot; Type=Mono is for codes, SKUs and measurements, Type=Empty shows a grey dash instead of the slot.
 * Inline puts the label on the left (160 px column).
 *   <rs-data-field label="Código" icon="barcode" type="mono">6205-2RS</rs-data-field>
 */
@Component({
  selector: 'rs-data-field',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-layout]': 'layout()', '[attr.data-type]': 'type()' },
  templateUrl: './data-field.component.html',
  styleUrl: './data-field.component.scss',
})
export class DataFieldComponent {
  readonly label = input.required<string>();
  readonly layout = input<DataFieldLayout>('stacked');
  readonly type = input<DataFieldType>('text');
  /** Figma ShowIcon. */
  readonly showIcon = input(true, { transform: booleanAttribute });
  /** Figma Icon: glyph that tells the data type. */
  readonly icon = input<IconName>('package');
}
