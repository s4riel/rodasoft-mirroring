import { Reflector } from '@nestjs/core';
import { REQUIRED_PERMISSIONS } from '../../access/require-permissions.decorator';
import { SalesOrdersController } from '../orders/sales-orders.controller';
import { QuotesController } from './quotes.controller';

/** Quotes need `sales.quotes.manage`; turning one into an order, and every order action, need `sales.orders.manage`. */
describe('quotes and orders permissions', () => {
  const reflector = new Reflector();
  const required = (controller: new (...args: never[]) => unknown, method: string) =>
    reflector.get(REQUIRED_PERMISSIONS, (controller.prototype as Record<string, () => unknown>)[method]);

  it.each(['list', 'context', 'customers', 'productSearch', 'detail', 'create', 'send', 'renew', 'reject'])('QuotesController.%s needs sales.quotes.manage', (method) => {
    expect(required(QuotesController, method)).toEqual(['sales.quotes.manage']);
  });

  it('converting a quote needs sales.orders.manage', () => {
    expect(required(QuotesController, 'convert')).toEqual(['sales.orders.manage']);
  });

  it('every order endpoint needs sales.orders.manage', () => {
    expect(reflector.get(REQUIRED_PERMISSIONS, SalesOrdersController)).toEqual(['sales.orders.manage']);
  });
});
