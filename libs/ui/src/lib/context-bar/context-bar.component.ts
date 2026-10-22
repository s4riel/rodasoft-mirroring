import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

export interface BranchOption {
  id: string;
  name: string;
}

/** Value of `branchId` when the "all branches" option is selected (Figma `Branch=All`). */
export const ALL_BRANCHES = 'all';

let nextId = 0;

/**
 * Figma: ContextBar State=Default|Focus|Disabled x Branch=Single|Multiple|All.
 * The company is a fixed label (defined by the URL); only the branch is chosen.
 * Single: no selector; Multiple: selector; All: selector that also offers "all branches" (Management role).
 * Optional right side (global search, alerts, user): `<div rsContextActions>` (not in Figma, kept for the shell).
 */
@Component({
  selector: 'rs-context-bar',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-branch]': 'branchMode()' },
  template: `
    <div class="field company">
      <span class="label">{{ companyLabel() }}</span>
      <div class="value">
        <span class="strong">{{ company() }}</span>
      </div>
    </div>
    <div class="field branch">
      <label class="label" [attr.for]="selectId">{{ branchLabel() }}</label>
      @if (selectable()) {
        <div class="control">
          <select [id]="selectId" [disabled]="disabled()" (change)="branchId.set($any($event.target).value)">
            @if (allowAll()) {
              <option [value]="all" [selected]="branchId() === all">{{ allLabel() }}</option>
            }
            @for (b of branches(); track b.id) {
              <option [value]="b.id" [selected]="b.id === branchId()">{{ b.name }}</option>
            }
          </select>
          <rs-icon class="chevron" name="chevron-down" [size]="16" />
        </div>
      } @else {
        <div class="value">
          <span class="strong" [id]="selectId">{{ singleName() }}</span>
        </div>
      }
    </div>
    @if (description()) {
      <p class="description">{{ description() }}</p>
    }
    <div class="actions"><ng-content select="[rsContextActions]" /></div>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: var(--space-6);
      padding: var(--space-4);
      overflow: hidden;
      background: var(--bg-surface);
      border: var(--stroke-default) solid var(--border-default);
      border-radius: var(--radius-sm);
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      flex: none;
      width: 320px; /* Figma field width, no token */
      max-width: 100%;
    }
    .label {
      font-size: var(--label-md-size);
      line-height: var(--label-md-line-height);
      font-weight: var(--label-md-weight);
      letter-spacing: var(--label-md-tracking);
      color: var(--text-primary);
      white-space: nowrap;
    }
    .value {
      display: flex;
      align-items: center;
      height: 45px; /* Figma value row, no token */
    }
    .strong {
      font-size: var(--body-md-strong-size);
      line-height: var(--body-md-strong-line-height);
      font-weight: var(--body-md-strong-weight);
      letter-spacing: var(--body-md-strong-tracking);
      color: var(--text-primary);
      white-space: nowrap;
    }
    .control {
      position: relative;
    }
    select {
      appearance: none;
      -webkit-appearance: none;
      width: 100%;
      padding: var(--space-3) calc(var(--space-3) * 2 + 16px) var(--space-3) var(--space-3);
      border: var(--stroke-default) solid var(--border-control);
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
      color: var(--text-primary);
      font-family: var(--font-family-ui);
      font-size: var(--body-md-size);
      line-height: var(--body-md-line-height);
      text-overflow: ellipsis;
      cursor: pointer;
    }
    select:hover:not(:disabled) {
      border-color: var(--text-primary);
    }
    select:focus-visible {
      outline: var(--stroke-focus) solid var(--focus-control);
      outline-offset: var(--focus-offset);
    }
    select:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .chevron {
      position: absolute;
      top: 50%;
      right: var(--space-3);
      transform: translateY(-50%);
      pointer-events: none;
      color: var(--text-primary);
    }
    .description {
      flex: 1 1 0;
      min-width: 0;
      margin: 0;
      color: var(--text-muted);
      font-size: var(--body-sm-size);
      line-height: var(--body-sm-line-height);
      white-space: pre-line;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin-left: auto;
    }
    .actions:empty {
      display: none;
    }
  `,
})
export class ContextBarComponent {
  protected readonly selectId = `rs-context-branch-${nextId++}`;
  protected readonly all = ALL_BRANCHES;

  /** Company name (fixed label; comes from the URL). */
  readonly company = input.required<string>();
  readonly branches = input<readonly BranchOption[]>([]);
  /** Figma `Branch=All`: adds the "all branches" option. */
  readonly allowAll = input(false, { transform: booleanAttribute });
  /** Selected branch id, or `ALL_BRANCHES`. */
  readonly branchId = model<string>(ALL_BRANCHES);
  readonly disabled = input(false, { transform: booleanAttribute });
  /** Visible texts (Spanish copy comes from the app). */
  readonly companyLabel = input('');
  readonly branchLabel = input('');
  readonly allLabel = input('');
  readonly description = input('');

  protected readonly selectable = computed(() => this.allowAll() || this.branches().length > 1);
  protected readonly branchMode = computed<'all' | 'multiple' | 'single'>(() =>
    this.allowAll() ? 'all' : this.branches().length > 1 ? 'multiple' : 'single',
  );
  protected readonly singleName = computed(() => {
    const id = this.branchId();
    return (this.branches().find((b) => b.id === id) ?? this.branches()[0])?.name ?? '—';
  });
}
