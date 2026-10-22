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
  templateUrl: './context-bar.component.html',
  styleUrl: './context-bar.component.scss',
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
