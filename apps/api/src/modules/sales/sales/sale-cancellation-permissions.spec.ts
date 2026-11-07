import { Reflector } from '@nestjs/core';
import { REQUIRED_ANY_PERMISSIONS, REQUIRED_PERMISSIONS } from '../../access/require-permissions.decorator';
import { SaleCancellationController } from './sale-cancellation.controller';

/** Asking needs `sales.cancellations.request`; taking a request back is also open to who may approve cancellations. */
describe('SaleCancellationController permissions', () => {
  const reflector = new Reflector();
  const proto = SaleCancellationController.prototype;

  it('requires sales.cancellations.request to ask for a cancellation', () => {
    expect(reflector.get(REQUIRED_PERMISSIONS, proto.request)).toEqual(['sales.cancellations.request']);
    expect(reflector.get(REQUIRED_ANY_PERMISSIONS, proto.request)).toBeUndefined();
  });

  it('accepts the request or the approve permission to withdraw', () => {
    expect(reflector.get(REQUIRED_ANY_PERMISSIONS, proto.withdraw)).toEqual(['sales.cancellations.request', 'sales.cancellations.approve']);
    expect(reflector.get(REQUIRED_PERMISSIONS, proto.withdraw)).toBeUndefined();
  });

  it('has no class-level permission that would stack on top', () => {
    expect(reflector.get(REQUIRED_PERMISSIONS, SaleCancellationController)).toBeUndefined();
    expect(reflector.get(REQUIRED_ANY_PERMISSIONS, SaleCancellationController)).toBeUndefined();
  });
});
