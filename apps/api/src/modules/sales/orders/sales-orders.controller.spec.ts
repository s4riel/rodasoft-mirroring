import { SalesOrdersController } from './sales-orders.controller';
import type { SalesOrderDispatchService } from './sales-order-dispatch.service';
import type { SalesOrdersService } from './sales-orders.service';

/** HU-VEN-20 · the dispatch endpoint needs the `Idempotency-Key` header, so a repeated request is harmless. */
describe('SalesOrdersController.dispatch', () => {
  const dispatch = jest.fn().mockResolvedValue({ id: 'o1' });
  const controller = new SalesOrdersController({} as SalesOrdersService, { dispatch } as unknown as SalesOrderDispatchService);
  const body = { items: [{ orderItemId: '3f2b1f0e-8a52-4c0a-9a43-7d1e0c9a1111', quantity: 1 }] };
  const codeOf = (fn: () => unknown): string | null => {
    try {
      fn();
      return null;
    } catch (err) {
      return (err as { getResponse: () => { code: string } }).getResponse().code;
    }
  };

  beforeEach(() => dispatch.mockClear());

  it('refuses a request without the header, or with a blank or oversized one', () => {
    expect(codeOf(() => controller.dispatch('o1', body))).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(codeOf(() => controller.dispatch('o1', body, '   '))).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(codeOf(() => controller.dispatch('o1', body, 'x'.repeat(101)))).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('passes the trimmed key to the service', async () => {
    await controller.dispatch('o1', body, '  key-1  ');
    expect(dispatch).toHaveBeenCalledWith('o1', body, 'key-1');
  });
});
