/**
 * Minimal, explicit state machine. Each document (invoice, transfer, purchase order…)
 * declares its transitions; the service calls `next()` before changing the status
 * and records the change in the audit log.
 */
export type Transitions<S extends string, E extends string> = Record<S, Partial<Record<E, S>>>;

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: string,
    readonly event: string,
  ) {
    super(`Transition not allowed: "${event}" from "${from}"`);
    this.name = 'InvalidTransitionError';
  }
}

export function createMachine<S extends string, E extends string>(transitions: Transitions<S, E>) {
  return {
    next(from: S, event: E): S {
      const to = transitions[from]?.[event];
      if (!to) throw new InvalidTransitionError(from, event);
      return to;
    },
    can(from: S, event: E): boolean {
      return !!transitions[from]?.[event];
    },
    events(from: S): E[] {
      return Object.keys(transitions[from] ?? {}) as E[];
    },
  };
}

// ── Product catalog status (HU-INV-09) ──
export type ProductLifecycleStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE';
export type ProductStatusEvent = 'activate' | 'deactivate' | 'reactivate';

/**
 * A draft becomes ACTIVE when it is finished, and can only be deleted, never deactivated. A finished product goes back
 * and forth between ACTIVE and INACTIVE; nothing returns to DRAFT.
 */
export const productStatusMachine = createMachine<ProductLifecycleStatus, ProductStatusEvent>({
  DRAFT: { activate: 'ACTIVE' },
  ACTIVE: { deactivate: 'INACTIVE' },
  INACTIVE: { reactivate: 'ACTIVE' },
});

// ── Transfers between branches (inventario-transferencias-flujo.md) ──
export type TransferStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'IN_TRANSIT'
  | 'PARTIALLY_RECEIVED'
  | 'RECEIVED'
  | 'REJECTED'
  | 'CANCELLED';
export type TransferEvent =
  | 'send'
  | 'requestApproval'
  | 'approve'
  | 'reject'
  | 'dispatch'
  | 'receivePartial'
  | 'receiveAll'
  | 'close'
  | 'cancel';

export const transferMachine = createMachine<TransferStatus, TransferEvent>({
  DRAFT: { send: 'IN_TRANSIT', requestApproval: 'PENDING_APPROVAL', cancel: 'CANCELLED' },
  PENDING_APPROVAL: { approve: 'APPROVED', reject: 'REJECTED' },
  APPROVED: { dispatch: 'IN_TRANSIT', cancel: 'CANCELLED' },
  // cancelling a sent transfer gives the pieces back to the origin; once some arrived (PARTIALLY_RECEIVED) it is closed instead
  IN_TRANSIT: { receivePartial: 'PARTIALLY_RECEIVED', receiveAll: 'RECEIVED', close: 'RECEIVED', cancel: 'CANCELLED' },
  PARTIALLY_RECEIVED: { receivePartial: 'PARTIALLY_RECEIVED', receiveAll: 'RECEIVED', close: 'RECEIVED' },
  RECEIVED: {},
  REJECTED: {},
  CANCELLED: {},
});

// ── Stock adjustment document (HU-INV-21 creates it; HU-INV-23 approves it) ──
export type StockAdjustmentStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
export type StockAdjustmentEvent = 'approve' | 'reject';

/** Only used to create documents for now: HU-INV-23 drives the transitions. */
export const stockAdjustmentMachine = createMachine<StockAdjustmentStatus, StockAdjustmentEvent>({
  PENDING_APPROVAL: { approve: 'APPROVED', reject: 'REJECTED' },
  APPROVED: {},
  REJECTED: {},
});

// ── SIAT invoice (invoicing close plan) ──
export type InvoiceStatus =
  | 'PENDING'
  | 'SENDING'
  | 'VALID'
  | 'REJECTED'
  | 'CONTINGENCY'
  | 'OBSERVED'
  | 'CANCELLATION_PENDING'
  | 'CANCELLED';
export type InvoiceEvent =
  | 'send'
  | 'accept'
  | 'reject'
  | 'offline'
  | 'packageValidated'
  | 'packageObserved'
  | 'fix'
  | 'requestCancellation'
  | 'approveCancellation'
  | 'rejectCancellation';

export const invoiceMachine = createMachine<InvoiceStatus, InvoiceEvent>({
  PENDING: { send: 'SENDING', offline: 'CONTINGENCY' },
  SENDING: { accept: 'VALID', reject: 'REJECTED', offline: 'CONTINGENCY' },
  REJECTED: { fix: 'PENDING' },
  CONTINGENCY: { packageValidated: 'VALID', packageObserved: 'OBSERVED' },
  OBSERVED: { fix: 'PENDING' },
  VALID: { requestCancellation: 'CANCELLATION_PENDING' },
  CANCELLATION_PENDING: { approveCancellation: 'CANCELLED', rejectCancellation: 'VALID' },
  CANCELLED: {},
});
