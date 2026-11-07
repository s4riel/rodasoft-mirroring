import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { ToastService } from '@rodasoft/ui';
import { ContextStore } from '../../core/context.store';
import { requiresSalesPermission } from './sales-permission.guard';

describe('requiresSalesPermission', () => {
  const warning = jest.fn();

  function run(context: unknown, permissions: string[]) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ToastService, useValue: { warning } },
        { provide: ContextStore, useValue: { context: signal(context), permissions: signal(new Set(permissions)) } },
      ],
    });
    return TestBed.runInInjectionContext(() => requiresSalesPermission('sales.cancellations.approve', 'Sin permiso')({} as never, {} as never));
  }

  beforeEach(() => warning.mockClear());

  it('lets the route through while the context is not loaded: the API checks the permission', () => {
    expect(run(null, [])).toBe(true);
    expect(warning).not.toHaveBeenCalled();
  });

  it('lets who holds the permission through', () => {
    expect(run({ loaded: true }, ['sales.cancellations.approve'])).toBe(true);
  });

  it('sends who lacks it back to the history with the reason', () => {
    const result = run({ loaded: true }, ['sales.pos.use']);
    expect(result).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/sales/history');
    expect(warning).toHaveBeenCalledWith('Sin permiso');
  });
});
