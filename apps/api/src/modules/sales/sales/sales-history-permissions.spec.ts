import { Reflector } from '@nestjs/core';
import { REQUIRED_ANY_PERMISSIONS, REQUIRED_PERMISSIONS } from '../../access/require-permissions.decorator';
import { SaleReceiptController } from './sale-receipt.controller';
import { SalesHistoryController } from './sales-history.controller';

/**
 * The history and the receipt are for who sells or who may see every sale: a custom role holding only
 * `sales.history.view-all` must get in, so neither controller may require `sales.pos.use` on its own.
 */
describe.each([
  ['SalesHistoryController', SalesHistoryController],
  ['SaleReceiptController', SaleReceiptController],
])('%s permissions', (_name, controller) => {
  const reflector = new Reflector();

  it('accepts sales.pos.use or sales.history.view-all', () => {
    expect(reflector.get(REQUIRED_ANY_PERMISSIONS, controller)).toEqual(['sales.pos.use', 'sales.history.view-all']);
  });

  it('does not also require sales.pos.use for everyone', () => {
    expect(reflector.get(REQUIRED_PERMISSIONS, controller)).toBeUndefined();
  });
});
