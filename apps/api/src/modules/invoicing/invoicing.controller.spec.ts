import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DEFAULT_ROLES } from '@rodasoft/domain';
import { MembershipService } from '../access/membership.service';
import { PermissionsGuard } from '../access/permissions.guard';
import { REQUIRED_PERMISSIONS } from '../access/require-permissions.decorator';
import { InvoicingController } from './invoicing.controller';

const proto = InvoicingController.prototype;

/** What each route of the invoicing API asks for (HU-FAC-01…10): the guard itself is shared, so this pins the permission of each handler. */
describe('InvoicingController permissions', () => {
  const reflector = new Reflector();
  const required = (handler: (...args: never[]) => unknown) => reflector.get(REQUIRED_PERMISSIONS, handler);

  it.each([
    ['status', proto.status, 'invoicing.invoices.view'],
    ['list', proto.list, 'invoicing.invoices.view'],
    ['detail', proto.detail, 'invoicing.invoices.view'],
    ['pdf', proto.pdf, 'invoicing.invoices.view'],
    ['xml', proto.xml, 'invoicing.invoices.view'],
    ['download', proto.download, 'invoicing.invoices.view'],
    ['deliver', proto.deliver, 'invoicing.invoices.view'],
    ['deliverMany', proto.deliverMany, 'invoicing.invoices.view'],
    ['issue', proto.issue, 'invoicing.invoices.issue'],
    ['issueMany', proto.issueMany, 'invoicing.invoices.issue'],
    ['resend', proto.resend, 'invoicing.invoices.issue'],
    ['updateCustomer', proto.updateCustomer, 'invoicing.invoices.issue'],
    ['verifyNit', proto.verifyNit, 'invoicing.invoices.issue'],
    ['requestNitException', proto.requestNitException, 'invoicing.invoices.issue'],
    ['approveNitException', proto.approveNitException, 'invoicing.nit-exception.approve'],
    ['rejectNitException', proto.rejectNitException, 'invoicing.nit-exception.approve'],
    ['requestCancellation', proto.requestCancellation, 'sales.cancellations.request'],
    ['pendingCancellations', proto.pendingCancellations, 'sales.cancellations.approve'],
  ])('%s needs %s', (_name, handler, permission) => {
    expect(required(handler as never)).toEqual([permission]);
  });

  describe('the guard on the NIT exception decision', () => {
    const contextOf = (handler: (...args: never[]) => unknown, mid: string): ExecutionContext =>
      ({
        getHandler: () => handler,
        getClass: () => InvoicingController,
        switchToHttp: () => ({ getRequest: () => ({ user: { mid } }) }),
      }) as unknown as ExecutionContext;
    const membership = {
      permissions: async (mid: string) =>
        new Set(mid === 'management' ? ['invoicing.nit-exception.approve'] : ['sales.pos.use', 'invoicing.invoices.view', 'invoicing.invoices.issue']),
    } as unknown as MembershipService;
    const guard = new PermissionsGuard(new Reflector(), membership);

    it.each([
      ['approve', proto.approveNitException],
      ['reject', proto.rejectNitException],
    ])('answers 403 NO_PERMISSION on %s to who may only issue, such as a cashier', async (_name, handler) => {
      const attempt = guard.canActivate(contextOf(handler as never, 'cashier'));
      await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
      await expect(attempt).rejects.toMatchObject({ response: { code: 'NO_PERMISSION' } });
    });

    it('lets the holder of invoicing.nit-exception.approve decide', async () => {
      await expect(guard.canActivate(contextOf(proto.approveNitException as never, 'management'))).resolves.toBe(true);
    });

    it('the default cashier role cannot decide a NIT exception', () => {
      expect(DEFAULT_ROLES['cashier'].permissions).not.toContain('invoicing.nit-exception.approve');
    });
  });
});
