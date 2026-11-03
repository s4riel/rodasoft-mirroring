import {
  approvalRequestMachine,
  cashShiftMachine,
  InvalidTransitionError,
  invoiceMachine,
  posCheckoutMachine,
  productStatusMachine,
  quoteMachine,
  saleMachine,
  salesOrderMachine,
  stockAdjustmentMachine,
  transferMachine,
} from './state-machine';

describe('state machines', () => {
  it('a product goes back and forth between active and inactive', () => {
    const inactive = productStatusMachine.next('ACTIVE', 'deactivate');
    expect(inactive).toBe('INACTIVE');
    expect(productStatusMachine.next(inactive, 'reactivate')).toBe('ACTIVE');
  });

  it('a draft is activated when finished but cannot be deactivated', () => {
    expect(productStatusMachine.next('DRAFT', 'activate')).toBe('ACTIVE');
    expect(() => productStatusMachine.next('DRAFT', 'deactivate')).toThrow(InvalidTransitionError);
    expect(() => productStatusMachine.next('DRAFT', 'reactivate')).toThrow(InvalidTransitionError);
  });

  it('an inactive product cannot be deactivated again and an active one cannot be reactivated', () => {
    expect(productStatusMachine.can('INACTIVE', 'deactivate')).toBe(false);
    expect(productStatusMachine.can('ACTIVE', 'reactivate')).toBe(false);
  });

  it('a transfer over the limit goes through approval', () => {
    let s = transferMachine.next('DRAFT', 'requestApproval');
    s = transferMachine.next(s, 'approve');
    s = transferMachine.next(s, 'dispatch');
    s = transferMachine.next(s, 'receivePartial');
    expect(transferMachine.next(s, 'receiveAll')).toBe('RECEIVED');
  });

  it('a partially received transfer closes with its differences, and nothing else leaves RECEIVED', () => {
    expect(transferMachine.next('PARTIALLY_RECEIVED', 'close')).toBe('RECEIVED');
    expect(transferMachine.next('IN_TRANSIT', 'close')).toBe('RECEIVED');
    expect(() => transferMachine.next('RECEIVED', 'close')).toThrow(InvalidTransitionError);
    expect(() => transferMachine.next('DRAFT', 'close')).toThrow(InvalidTransitionError);
  });

  it('an adjustment waits for approval and is final once decided', () => {
    expect(stockAdjustmentMachine.next('PENDING_APPROVAL', 'approve')).toBe('APPROVED');
    expect(stockAdjustmentMachine.next('PENDING_APPROVAL', 'reject')).toBe('REJECTED');
    expect(stockAdjustmentMachine.events('APPROVED')).toEqual([]);
  });

  it('a transfer can be cancelled while nothing has arrived, and not once it was received in part', () => {
    expect(transferMachine.next('DRAFT', 'cancel')).toBe('CANCELLED');
    expect(transferMachine.next('IN_TRANSIT', 'cancel')).toBe('CANCELLED');
    expect(() => transferMachine.next('PARTIALLY_RECEIVED', 'cancel')).toThrow(InvalidTransitionError);
    expect(() => transferMachine.next('RECEIVED', 'cancel')).toThrow(InvalidTransitionError);
  });

  it('an invoice stays valid until management approves the cancellation', () => {
    const s = invoiceMachine.next('VALID', 'requestCancellation');
    expect(s).toBe('CANCELLATION_PENDING');
    expect(invoiceMachine.next(s, 'rejectCancellation')).toBe('VALID');
    expect(invoiceMachine.events('CANCELLED')).toEqual([]);
  });
});

describe('sales state machines (HU-VEN-00)', () => {
  it('a cash shift is closed, then approved or observed, and nothing reopens it', () => {
    const closed = cashShiftMachine.next('OPEN', 'close');
    expect(closed).toBe('CLOSED');
    expect(cashShiftMachine.next(closed, 'approve')).toBe('APPROVED');
    expect(cashShiftMachine.next(closed, 'observe')).toBe('OBSERVED');
    expect(() => cashShiftMachine.next('OPEN', 'approve')).toThrow(InvalidTransitionError);
    expect(() => cashShiftMachine.next('CLOSED', 'close')).toThrow(InvalidTransitionError);
    expect(cashShiftMachine.events('APPROVED')).toEqual([]);
  });

  it('a checkout goes from the cart to payment to a completed sale', () => {
    const paying = posCheckoutMachine.next('OPEN', 'pay');
    expect(paying).toBe('PAYING');
    expect(posCheckoutMachine.next(paying, 'complete')).toBe('COMPLETED');
  });

  it('a checkout in payment can go back to the cart, and a cart can be held, resumed or abandoned', () => {
    expect(posCheckoutMachine.next('PAYING', 'back')).toBe('OPEN');
    const held = posCheckoutMachine.next('OPEN', 'hold');
    expect(held).toBe('ON_HOLD');
    expect(posCheckoutMachine.next(held, 'resume')).toBe('OPEN');
    expect(posCheckoutMachine.next('OPEN', 'abandon')).toBe('ABANDONED');
    expect(posCheckoutMachine.next('ON_HOLD', 'abandon')).toBe('ABANDONED');
  });

  it('a checkout cannot skip payment or leave a final state', () => {
    expect(() => posCheckoutMachine.next('OPEN', 'complete')).toThrow(InvalidTransitionError);
    expect(() => posCheckoutMachine.next('PAYING', 'hold')).toThrow(InvalidTransitionError);
    expect(() => posCheckoutMachine.next('PAYING', 'abandon')).toThrow(InvalidTransitionError);
    expect(posCheckoutMachine.events('COMPLETED')).toEqual([]);
    expect(posCheckoutMachine.events('ABANDONED')).toEqual([]);
  });

  it('a sale waits for approval to be cancelled, and a rejection puts it back to completed', () => {
    const pending = saleMachine.next('COMPLETED', 'requestCancellation');
    expect(pending).toBe('CANCELLATION_PENDING');
    expect(saleMachine.next(pending, 'approveCancellation')).toBe('CANCELLED');
    expect(saleMachine.next(pending, 'rejectCancellation')).toBe('COMPLETED');
    expect(() => saleMachine.next('COMPLETED', 'approveCancellation')).toThrow(InvalidTransitionError);
    expect(saleMachine.events('CANCELLED')).toEqual([]);
  });

  it('an approval request is decided once', () => {
    expect(approvalRequestMachine.next('PENDING', 'approve')).toBe('APPROVED');
    expect(approvalRequestMachine.next('PENDING', 'reject')).toBe('REJECTED');
    expect(() => approvalRequestMachine.next('APPROVED', 'reject')).toThrow(InvalidTransitionError);
    expect(approvalRequestMachine.events('REJECTED')).toEqual([]);
  });

  it('a quote is sent and then accepted, rejected or expires', () => {
    const sent = quoteMachine.next('DRAFT', 'send');
    expect(sent).toBe('SENT');
    expect(quoteMachine.next(sent, 'accept')).toBe('ACCEPTED');
    expect(quoteMachine.next(sent, 'reject')).toBe('REJECTED');
    expect(quoteMachine.next(sent, 'expire')).toBe('EXPIRED');
    expect(() => quoteMachine.next('DRAFT', 'accept')).toThrow(InvalidTransitionError);
  });

  it('only an expired quote can be renewed, and it goes back to sent', () => {
    expect(quoteMachine.next('EXPIRED', 'renew')).toBe('SENT');
    expect(() => quoteMachine.next('SENT', 'renew')).toThrow(InvalidTransitionError);
    expect(() => quoteMachine.next('ACCEPTED', 'renew')).toThrow(InvalidTransitionError);
  });

  it('an order is dispatched in parts or at once, and can be cancelled until it is fully dispatched', () => {
    let s = salesOrderMachine.next('OPEN', 'dispatchPartial');
    expect(s).toBe('PARTIALLY_DISPATCHED');
    s = salesOrderMachine.next(s, 'dispatchPartial');
    expect(salesOrderMachine.next(s, 'dispatchAll')).toBe('DISPATCHED');
    expect(salesOrderMachine.next('OPEN', 'dispatchAll')).toBe('DISPATCHED');
    expect(salesOrderMachine.next('OPEN', 'cancel')).toBe('CANCELLED');
    expect(salesOrderMachine.next('PARTIALLY_DISPATCHED', 'cancel')).toBe('CANCELLED');
    expect(() => salesOrderMachine.next('DISPATCHED', 'cancel')).toThrow(InvalidTransitionError);
    expect(() => salesOrderMachine.next('CANCELLED', 'dispatchAll')).toThrow(InvalidTransitionError);
  });
});
