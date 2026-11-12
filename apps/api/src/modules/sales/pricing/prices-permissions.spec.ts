import { Reflector } from '@nestjs/core';
import { REQUIRED_ANY_PERMISSIONS, REQUIRED_PERMISSIONS } from '../../access/require-permissions.decorator';
import { PricesController } from './prices.controller';

/** Decision #18: consulting and editing prices is `sales.prices.edit`, for the whole controller (HU-VEN-26). */
describe('Prices controller permissions', () => {
  const reflector = new Reflector();

  it('requires sales.prices.edit on every route', () => {
    expect(reflector.get(REQUIRED_PERMISSIONS, PricesController)).toEqual(['sales.prices.edit']);
    expect(reflector.get(REQUIRED_ANY_PERMISSIONS, PricesController)).toBeUndefined();
  });

  it.each(['list', 'detail', 'edit', 'bulkPreview', 'bulkApply'] as const)('does not loosen it on %s', (handler) => {
    expect(reflector.get(REQUIRED_PERMISSIONS, PricesController.prototype[handler])).toBeUndefined();
    expect(reflector.get(REQUIRED_ANY_PERMISSIONS, PricesController.prototype[handler])).toBeUndefined();
  });
});
