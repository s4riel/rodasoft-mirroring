import type { CanDeactivateFn } from '@angular/router';

/** A page that knows whether leaving would lose changes, and asks the user when it would. */
export interface ConfirmsLeave {
  confirmLeave(): boolean | Promise<boolean>;
}

/** The transfer editor asks before leaving with changes that were not saved. */
export const unsavedTransferGuard: CanDeactivateFn<ConfirmsLeave> = (page) => page.confirmLeave();
