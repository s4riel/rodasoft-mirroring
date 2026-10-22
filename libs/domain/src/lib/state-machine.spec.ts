import { InvalidTransitionError, invoiceMachine, transferMachine } from './state-machine';

describe('state machines', () => {
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
