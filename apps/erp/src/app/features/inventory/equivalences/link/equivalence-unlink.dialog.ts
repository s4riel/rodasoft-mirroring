import { ChangeDetectionStrategy, Component, inject, input, model, output, signal } from '@angular/core';
import { ButtonComponent, ModalComponent, NoteComponent, ToastService } from '@rodasoft/ui';
import { problemOf } from '../../../../core/api-error';
import { EquivalencesApi } from '../equivalences-api.service';

/** The link the dialog removes: its id and how to name the pair to the user. */
export interface UnlinkTarget {
  id: string;
  /** "6205-2RS · SKF y 6205-DDU · NSK" */
  pairLabel: string;
}

/** Confirmation before removing a link. The products and their stock are untouched. */
@Component({
  selector: 'rs-equivalence-unlink-dialog',
  imports: [ButtonComponent, ModalComponent, NoteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './equivalence-unlink.dialog.html',
  styleUrl: './equivalence-unlink.dialog.scss',
})
export class EquivalenceUnlinkDialog {
  private readonly api = inject(EquivalencesApi);
  private readonly toast = inject(ToastService);

  readonly open = model(false);
  readonly target = input<UnlinkTarget | null>(null);
  readonly unlinked = output<string>();

  protected readonly saving = signal(false);
  protected readonly submitError = signal<string | null>(null);

  protected cancel() {
    if (!this.saving()) this.open.set(false);
  }

  protected confirm() {
    const target = this.target();
    if (!target || this.saving()) return;
    this.saving.set(true);
    this.submitError.set(null);
    this.api.unlink(target.id).subscribe({
      next: () => {
        this.saving.set(false);
        this.open.set(false);
        this.toast.success('Equivalencia desvinculada');
        this.unlinked.emit(target.id);
      },
      error: (err: unknown) => {
        const problem = problemOf(err);
        this.saving.set(false);
        // already gone: the list is stale, so refresh it as if it had worked
        if (problem.code === 'EQUIVALENCE_NOT_FOUND') {
          this.open.set(false);
          this.unlinked.emit(target.id);
          return;
        }
        this.submitError.set(problem.message);
      },
    });
  }
}
