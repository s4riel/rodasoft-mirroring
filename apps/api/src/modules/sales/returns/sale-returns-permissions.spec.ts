import { Reflector } from '@nestjs/core';
import { REQUIRED_ANY_PERMISSIONS, REQUIRED_PERMISSIONS } from '../../access/require-permissions.decorator';
import { SaleReturnsController } from './sale-returns.controller';

/** Registering and listing returns is `sales.returns.manage`; deciding one is `sales.returns.approve` (HU-VEN-21). */
describe('SaleReturnsController permissions', () => {
  const reflector = new Reflector();
  const proto = SaleReturnsController.prototype;

  it.each(['list', 'lookup', 'create'] as const)('requires sales.returns.manage to %s', (handler) => {
    expect(reflector.get(REQUIRED_PERMISSIONS, proto[handler])).toEqual(['sales.returns.manage']);
  });

  it.each(['approve', 'reject'] as const)('requires sales.returns.approve to %s', (handler) => {
    expect(reflector.get(REQUIRED_PERMISSIONS, proto[handler])).toEqual(['sales.returns.approve']);
  });

  it('opens the detail to who registers or who decides', () => {
    expect(reflector.get(REQUIRED_ANY_PERMISSIONS, proto.detail)).toEqual(['sales.returns.manage', 'sales.returns.approve']);
    expect(reflector.get(REQUIRED_PERMISSIONS, proto.detail)).toBeUndefined();
  });
});
