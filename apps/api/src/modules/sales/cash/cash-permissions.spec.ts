import { Reflector } from '@nestjs/core';
import { REQUIRED_ANY_PERMISSIONS, REQUIRED_PERMISSIONS } from '../../access/require-permissions.decorator';
import { CashController, CashMovementsController } from './cash.controller';

/**
 * Registering movements and closing is `sales.cash-register.open`; deciding an expense is `sales.cash-expenses.approve`; the
 * shift can also be read by who reviews differences (HU-VEN-22, HU-VEN-23).
 */
describe('Cash controllers permissions', () => {
  const reflector = new Reflector();
  const shifts = CashController.prototype;
  const movements = CashMovementsController.prototype;

  it.each(['createMovement', 'close'] as const)('requires sales.cash-register.open to %s', (handler) => {
    expect(reflector.get(REQUIRED_PERMISSIONS, shifts[handler])).toEqual(['sales.cash-register.open']);
  });

  it('opens the shift summary to the cashier and to the reviewer', () => {
    expect(reflector.get(REQUIRED_ANY_PERMISSIONS, shifts.shift)).toEqual(['sales.cash-register.open', 'sales.cash-register.review']);
    expect(reflector.get(REQUIRED_PERMISSIONS, shifts.shift)).toBeUndefined();
  });

  it.each(['approve', 'reject'] as const)('requires sales.cash-expenses.approve to %s an expense', (handler) => {
    expect(reflector.get(REQUIRED_PERMISSIONS, movements[handler])).toEqual(['sales.cash-expenses.approve']);
  });

  it('lets only the cashier side withdraw a request', () => {
    expect(reflector.get(REQUIRED_PERMISSIONS, movements.withdraw)).toEqual(['sales.cash-register.open']);
  });

  it.each(['detail', 'receipt'] as const)('opens the %s of a movement to who registers and who approves', (handler) => {
    expect(reflector.get(REQUIRED_ANY_PERMISSIONS, movements[handler])).toEqual(['sales.cash-register.open', 'sales.cash-expenses.approve']);
  });
});
