import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DEFAULT_ROLES } from '@rodasoft/domain';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MembershipService } from '../../access/membership.service';
import { PermissionsGuard } from '../../access/permissions.guard';
import { REQUIRED_PERMISSIONS } from '../../access/require-permissions.decorator';
import { PosController } from '../pos/pos.controller';
import { CreatePosCustomerDto, SaveCustomerDto } from './customers.dto';
import { CustomersController } from './customers.controller';

const proto = CustomersController.prototype;

describe('CustomersController permissions (HU-VEN-37)', () => {
  const contextOf = (handler: (...args: never[]) => unknown, mid: string): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => CustomersController,
      switchToHttp: () => ({ getRequest: () => ({ user: { mid } }) }),
    }) as unknown as ExecutionContext;

  const membership = {
    permissions: async (mid: string) => new Set(mid === 'management' ? ['sales.customers.manage'] : ['sales.pos.use', 'crm.customers.view']),
  } as unknown as MembershipService;
  const guard = new PermissionsGuard(new Reflector(), membership);

  it.each([
    ['list', proto.list],
    ['get', proto.get],
    ['create', proto.create],
    ['update', proto.update],
  ])('answers 403 NO_PERMISSION on %s without sales.customers.manage, even to a cashier', async (_name, handler) => {
    const attempt = guard.canActivate(contextOf(handler, 'cashier'));
    await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
    await expect(attempt).rejects.toMatchObject({ response: { code: 'NO_PERMISSION' } });
  });

  it.each([
    ['list', proto.list],
    ['create', proto.create],
    ['update', proto.update],
  ])('lets a holder of sales.customers.manage use %s', async (_name, handler) => {
    await expect(guard.canActivate(contextOf(handler, 'management'))).resolves.toBe(true);
  });

  it('the default roles: Management has the permission and the cashier does not', () => {
    expect(DEFAULT_ROLES['management'].permissions).toContain('sales.customers.manage');
    expect(DEFAULT_ROLES['cashier'].permissions).not.toContain('sales.customers.manage');
    expect(DEFAULT_ROLES['cashier'].permissions).toContain('sales.pos.use');
  });

  it('the cashier’s POS routes need sales.pos.use, not the management permission', () => {
    const reflector = new Reflector();
    expect(reflector.get(REQUIRED_PERMISSIONS, PosController)).toEqual(['sales.pos.use']);
  });
});

describe('quick creation DTO (the cashier cannot set a discount or credit)', () => {
  const pipeErrors = (plain: object) => validateSync(plainToInstance(CreatePosCustomerDto, plain), { whitelist: true, forbidNonWhitelisted: true });
  const base = { name: 'Taller', documentType: 5, documentNumber: '1020304078' };

  it('accepts the quick-creation fields', () => {
    expect(pipeErrors(base)).toEqual([]);
  });

  it.each([
    ['discountType', 'PERCENT'],
    ['discountValue', '50'],
    ['creditEnabled', true],
    ['status', 'INACTIVE'],
  ])('rejects %s on the cashier route with a 400 validation error', (field, value) => {
    expect(pipeErrors({ ...base, [field]: value }).map((e) => e.property)).toEqual([field]);
  });

  it('the Management form does take them', () => {
    const errors = validateSync(
      plainToInstance(SaveCustomerDto, { ...base, creditEnabled: true, discountType: 'PERCENT', discountValue: '10.00' }),
      { whitelist: true, forbidNonWhitelisted: true },
    );
    expect(errors).toEqual([]);
  });
});
