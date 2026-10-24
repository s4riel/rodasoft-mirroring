import { InvalidTransitionError, invoiceMachine, productStatusMachine, transferMachine } from './state-machine';

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

  it('an in-transit transfer cannot be cancelled', () => {
    expect(() => transferMachine.next('IN_TRANSIT', 'cancel')).toThrow(InvalidTransitionError);
  });

  it('an invoice stays valid until management approves the cancellation', () => {
    const s = invoiceMachine.next('VALID', 'requestCancellation');
    expect(s).toBe('CANCELLATION_PENDING');
    expect(invoiceMachine.next(s, 'rejectCancellation')).toBe('VALID');
    expect(invoiceMachine.events('CANCELLED')).toEqual([]);
  });
});
