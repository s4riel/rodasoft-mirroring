import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Text link: `<a rsLink routerLink="…">Abrir</a>`. Underlined in the primary text colour, thicker underline on hover and the shared
 * focus ring on `:focus-visible`. There is no Figma master for it yet (the screens only show a plain underlined text link), so the
 * look follows the Link text style of the screens; re-check it against the Design System once the master exists.
 * States are CSS only. Used for navigation; an action that does not navigate is a button.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'a[rsLink]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'rs-link' },
  templateUrl: './link.component.html',
  styleUrl: './link.component.scss',
})
export class LinkComponent {}
