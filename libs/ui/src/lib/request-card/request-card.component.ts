import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type RequestCardTone = 'neutral' | 'negative';

/**
 * A request that waits for a decision, as the approvals inbox lists it (VP-25, HU-VEN-29): the kind of request, what it is
 * about, who asked and why, the amount, and the actions that decide it (projected with `slot="actions"`). It is not in the Figma
 * Design System as a component (VP-25 draws plain frames): estimated.
 *   <rs-request-card kicker="Devolución" title="DEV-000012 · V-000231" description="Ana Cajera · Falla de fábrica" amount="− Bs 200,00" tone="negative">
 *     <div slot="actions"><button rsButton>Aprobar</button></div>
 *   </rs-request-card>
 */
@Component({
  selector: 'rs-request-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'group', '[attr.aria-label]': 'title()', '[attr.data-tone]': 'tone()' },
  templateUrl: './request-card.component.html',
  styleUrl: './request-card.component.scss',
})
export class RequestCardComponent {
  /** The kind of request (small line above the title). */
  readonly kicker = input('');
  readonly title = input.required<string>();
  /** Who asked, about what. */
  readonly description = input('');
  /** What the requester wrote. */
  readonly detail = input('');
  /** The amount already formatted; empty when the request has none. */
  readonly amount = input('');
  /** `negative` tints the amount when the money leaves the company. */
  readonly tone = input<RequestCardTone>('neutral');
}
