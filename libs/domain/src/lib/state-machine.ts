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
  | 'void'
  | 'requestCancellation'
  | 'approveCancellation'
  | 'rejectCancellation';

export const invoiceMachine = createMachine<InvoiceStatus, InvoiceEvent>({
  // `void`: a cancelled sale whose invoice never left the system has nothing to cancel in the SIAT (HU-VEN-15)
  PENDING: { send: 'SENDING', offline: 'CONTINGENCY', void: 'CANCELLED' },
  SENDING: { accept: 'VALID', reject: 'REJECTED', offline: 'CONTINGENCY' },
  REJECTED: { fix: 'PENDING' },
  CONTINGENCY: { packageValidated: 'VALID', packageObserved: 'OBSERVED' },
  OBSERVED: { fix: 'PENDING' },
  VALID: { requestCancellation: 'CANCELLATION_PENDING' },
  CANCELLATION_PENDING: { approveCancellation: 'CANCELLED', rejectCancellation: 'VALID' },
  CANCELLED: {},
});

// ── Sales and POS (HU-VEN-00, docs/sales/design-notes.md) ──

/** A shift is closed by the cashier and then reviewed: approved, or observed when the count needs a follow-up. */
export type CashShiftStatus = 'OPEN' | 'CLOSED' | 'APPROVED' | 'OBSERVED';
export type CashShiftEvent = 'close' | 'approve' | 'observe';

export const cashShiftMachine = createMachine<CashShiftStatus, CashShiftEvent>({
  OPEN: { close: 'CLOSED' },
  CLOSED: { approve: 'APPROVED', observe: 'OBSERVED' },
  APPROVED: {},
  OBSERVED: {},
});

/**
 * A manual cash movement (HU-VEN-22). Only an expense above `sales.cashExpenseApprovalLimit` is ever `PENDING`; the rest are
 * created `POSTED`. A pending one does not count in the expected cash until Management approves it; the requester can withdraw it.
 */
export type CashMovementStatus = 'PENDING' | 'POSTED' | 'REJECTED' | 'WITHDRAWN';
export type CashMovementEvent = 'approve' | 'reject' | 'withdraw';

export const cashMovementMachine = createMachine<CashMovementStatus, CashMovementEvent>({
  PENDING: { approve: 'POSTED', reject: 'REJECTED', withdraw: 'WITHDRAWN' },
  POSTED: {},
  REJECTED: {},
  WITHDRAWN: {},
});

/**
 * The server-side cart. Completing it creates the sale in the same transaction. A checkout can leave PAYING for OPEN
 * (the cashier goes back to the cart) and can be put on hold or abandoned before it is paid.
 */
export type PosCheckoutStatus = 'OPEN' | 'PAYING' | 'COMPLETED' | 'ON_HOLD' | 'ABANDONED';
export type PosCheckoutEvent = 'pay' | 'complete' | 'back' | 'hold' | 'resume' | 'abandon';

export const posCheckoutMachine = createMachine<PosCheckoutStatus, PosCheckoutEvent>({
  OPEN: { pay: 'PAYING', hold: 'ON_HOLD', abandon: 'ABANDONED' },
  PAYING: { complete: 'COMPLETED', back: 'OPEN' },
  ON_HOLD: { resume: 'OPEN', abandon: 'ABANDONED' },
  COMPLETED: {},
  ABANDONED: {},
});

/**
 * A payment attempt of a checkout (QR in HU-VEN-08, card in HU-VEN-10; a declined card is retried with a new attempt). PENDING waits for the outcome; the other three are final. A
 * confirmed payment is never cancelled here: giving the money back is a return (HU-VEN-21).
 */
export type PaymentStatus = 'PENDING' | 'CONFIRMED' | 'DECLINED' | 'CANCELLED';
export type PaymentEvent = 'confirm' | 'decline' | 'cancel';

export const paymentMachine = createMachine<PaymentStatus, PaymentEvent>({
  PENDING: { confirm: 'CONFIRMED', decline: 'DECLINED', cancel: 'CANCELLED' },
  CONFIRMED: {},
  DECLINED: {},
  CANCELLED: {},
});

/**
 * A sale only exists once paid; a rejected or withdrawn cancellation request puts it back to COMPLETED (HU-VEN-14 asks and
 * withdraws, HU-VEN-15 decides).
 */
export type SaleStatus = 'COMPLETED' | 'CANCELLATION_PENDING' | 'CANCELLED';
export type SaleEvent = 'requestCancellation' | 'withdrawCancellation' | 'approveCancellation' | 'rejectCancellation';

export const saleMachine = createMachine<SaleStatus, SaleEvent>({
  COMPLETED: { requestCancellation: 'CANCELLATION_PENDING' },
  CANCELLATION_PENDING: { approveCancellation: 'CANCELLED', rejectCancellation: 'COMPLETED', withdrawCancellation: 'COMPLETED' },
  CANCELLED: {},
});

/** Generic approval inbox entry (cancellation, cash difference, return). The requester can withdraw it until it is decided. */
export type ApprovalRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
export type ApprovalRequestEvent = 'approve' | 'reject' | 'withdraw';

export const approvalRequestMachine = createMachine<ApprovalRequestStatus, ApprovalRequestEvent>({
  PENDING: { approve: 'APPROVED', reject: 'REJECTED', withdraw: 'WITHDRAWN' },
  APPROVED: {},
  REJECTED: {},
  WITHDRAWN: {},
});

/** An expired quote can be renewed: it goes back to SENT with a new validity date. */
export type QuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'EXPIRED' | 'REJECTED';
export type QuoteEvent = 'send' | 'accept' | 'expire' | 'reject' | 'renew';

export const quoteMachine = createMachine<QuoteStatus, QuoteEvent>({
  // a draft can be converted into an order before it is ever sent (HU-VEN-19)
  DRAFT: { send: 'SENT', accept: 'ACCEPTED' },
  SENT: { accept: 'ACCEPTED', expire: 'EXPIRED', reject: 'REJECTED' },
  // an expired quote can also be closed for good (HU-VEN-18)
  EXPIRED: { renew: 'SENT', reject: 'REJECTED' },
  ACCEPTED: {},
  REJECTED: {},
});

/** Cancelling an order that was partially dispatched releases only what is still reserved. */
export type SalesOrderStatus = 'OPEN' | 'PARTIALLY_DISPATCHED' | 'DISPATCHED' | 'CANCELLED';
export type SalesOrderEvent = 'dispatchPartial' | 'dispatchAll' | 'cancel';

export const salesOrderMachine = createMachine<SalesOrderStatus, SalesOrderEvent>({
  OPEN: { dispatchPartial: 'PARTIALLY_DISPATCHED', dispatchAll: 'DISPATCHED', cancel: 'CANCELLED' },
  PARTIALLY_DISPATCHED: { dispatchPartial: 'PARTIALLY_DISPATCHED', dispatchAll: 'DISPATCHED', cancel: 'CANCELLED' },
  DISPATCHED: {},
  CANCELLED: {},
});

/**
 * A return of a sale (HU-VEN-21). One under the approval limit is created `APPROVED` and does everything at once; one above
 * it waits as `PENDING_APPROVAL` until Management approves or rejects it.
 */
export type SaleReturnStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
export type SaleReturnEvent = 'approve' | 'reject';

export const saleReturnMachine = createMachine<SaleReturnStatus, SaleReturnEvent>({
  PENDING_APPROVAL: { approve: 'APPROVED', reject: 'REJECTED' },
  APPROVED: {},
  REJECTED: {},
});
