import { Reflector } from '@nestjs/core';
import { APPROVAL_TYPE_PERMISSION, APPROVAL_TYPES } from '@rodasoft/domain';
import { REQUIRED_ANY_PERMISSIONS, REQUIRED_PERMISSIONS } from '../../access/require-permissions.decorator';
import { ApprovalsController } from './approvals.controller';

/** The inbox opens for whoever holds any of the four approve permissions, and decides nothing (HU-VEN-29). */
describe('Approvals controller permissions', () => {
  const reflector = new Reflector();

  it('requires any of the four approve permissions on every route', () => {
    expect(reflector.get(REQUIRED_ANY_PERMISSIONS, ApprovalsController)).toEqual(APPROVAL_TYPES.map((type) => APPROVAL_TYPE_PERMISSION[type]));
    expect(reflector.get(REQUIRED_PERMISSIONS, ApprovalsController)).toBeUndefined();
  });

  it.each(['list', 'summary'] as const)('does not loosen or replace it on %s', (handler) => {
    expect(reflector.get(REQUIRED_ANY_PERMISSIONS, ApprovalsController.prototype[handler])).toBeUndefined();
    expect(reflector.get(REQUIRED_PERMISSIONS, ApprovalsController.prototype[handler])).toBeUndefined();
  });

  it('has no route that decides: decisions go through the endpoint of each type', () => {
    const methods = Object.getOwnPropertyNames(ApprovalsController.prototype).filter((name) => name !== 'constructor');
    expect(methods.sort()).toEqual(['list', 'summary']);
  });
});
