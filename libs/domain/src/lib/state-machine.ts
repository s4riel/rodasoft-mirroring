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
  | 'cancel';

export const transferMachine = createMachine<TransferStatus, TransferEvent>({
  DRAFT: { send: 'IN_TRANSIT', requestApproval: 'PENDING_APPROVAL', cancel: 'CANCELLED' },
  PENDING_APPROVAL: { approve: 'APPROVED', reject: 'REJECTED' },
  APPROVED: { dispatch: 'IN_TRANSIT', cancel: 'CANCELLED' },
  IN_TRANSIT: { receivePartial: 'PARTIALLY_RECEIVED', receiveAll: 'RECEIVED' },
  PARTIALLY_RECEIVED: { receivePartial: 'PARTIALLY_RECEIVED', receiveAll: 'RECEIVED' },
  RECEIVED: {},
  REJECTED: {},
  CANCELLED: {},
});

// ── SIAT invoice (facturacion-plan-cierre.md) ──
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
