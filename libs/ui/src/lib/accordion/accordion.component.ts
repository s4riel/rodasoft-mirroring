import { booleanAttribute, ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

let nextId = 0;

/**
 * Figma: Accordion Open=Off|On x State (Default/Hover/Focus/Disabled).
 * One collapsible section: `title` + projected content. `open` is two-way (Figma `Open`).
 */
@Component({
  selector: 'rs-accordion',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h3 class="heading">
      <button
        type="button"
        class="trigger"
        [id]="triggerId"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="panelId"
        [disabled]="disabled()"
        (click)="open.set(!open())"
      >
        <span class="title">{{ title() }}</span>
        <rs-icon class="chevron" name="chevron-down" [size]="20" />
      </button>
    </h3>
    @if (open()) {
      <div class="panel" role="region" [id]="panelId" [attr.aria-labelledby]="triggerId">
        <ng-content />
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      border-bottom: var(--stroke-default) solid var(--border-default);
    }
    .heading {
      margin: 0;
      font: inherit;
      letter-spacing: normal;
    }
    .trigger {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      width: 100%;
      min-height: 54px; /* Figma Open=Off height, no token */
      padding: var(--space-4) 0;
      border: 0;
      background: transparent;
      color: var(--text-primary);
      text-align: left;
      font-family: var(--font-family-ui);
      font-size: var(--body-md-strong-size);
      line-height: var(--body-md-strong-line-height);
      font-weight: var(--body-md-strong-weight);
      cursor: pointer;
    }
    .trigger:hover:not(:disabled) {
      color: var(--text-muted);
    }
    .trigger:focus-visible {
      outline: var(--stroke-focus) solid var(--focus-control);
      outline-offset: var(--focus-offset);
      border-radius: var(--radius-xs);
    }
    .trigger:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .chevron {
      transition: transform var(--motion-fast) var(--ease-out);
    }
    .trigger[aria-expanded='true'] .chevron {
      transform: rotate(180deg);
    }
    .panel {
      padding: 0 0 var(--space-4);
      color: var(--text-muted);
      font-size: var(--body-md-size);
      line-height: var(--body-md-line-height);
    }
  `,
})
export class AccordionComponent {
  private readonly uid = `rs-accordion-${nextId++}`;
  protected readonly triggerId = `${this.uid}-trigger`;
  protected readonly panelId = `${this.uid}-panel`;

  readonly title = input.required<string>();
  /** Figma `Open=On|Off`. */
  readonly open = model(false);
  readonly disabled = input(false, { transform: booleanAttribute });
}
