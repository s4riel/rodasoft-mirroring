import { creditBalance, creditSaleOwed, type CreditSaleFigures } from './credit-balance';

const sale = (over: Partial<CreditSaleFigures> = {}): CreditSaleFigures => ({
  status: 'COMPLETED',
  amount: '490.00',
  dueDate: '2026-12-01',
  returned: '0.00',
  ...over,
});

describe('creditSaleOwed', () => {
  it('owes the whole credit until something is returned', () => {
    expect(creditSaleOwed(sale()).toString()).toBe('490.00');
  });

  it('takes the approved returns off the debt, never below zero', () => {
    expect(creditSaleOwed(sale({ returned: '245.00' })).toString()).toBe('245.00');
    expect(creditSaleOwed(sale({ returned: '490.00' })).toString()).toBe('0.00');
    expect(creditSaleOwed(sale({ returned: '600.00' })).toString()).toBe('0.00');
  });

  it('owes nothing once the sale is cancelled, and still owes while a cancellation is only requested', () => {
    expect(creditSaleOwed(sale({ status: 'CANCELLED' })).toString()).toBe('0.00');
    expect(creditSaleOwed(sale({ status: 'CANCELLATION_PENDING' })).toString()).toBe('490.00');
  });
});

describe('creditBalance', () => {
  it('is zero for a customer without credit sales', () => {
    expect(creditBalance('c1', [], '2026-11-12')).toEqual({ customerId: 'c1', balance: '0.00', overdue: '0.00', openSales: 0, nextDueDate: null });
  });

  it('adds the open sales, splits the overdue part and names the earliest due date', () => {
    const result = creditBalance(
      'c1',
      [
        sale({ amount: '100.00', dueDate: '2026-11-01' }),
        sale({ amount: '300.00', dueDate: '2026-12-01', returned: '50.00' }),
        sale({ amount: '999.00', dueDate: '2026-11-05', status: 'CANCELLED' }),
        sale({ amount: '80.00', dueDate: '2026-11-20', returned: '80.00' }),
      ],
      '2026-11-12',
    );
    expect(result).toEqual({ customerId: 'c1', balance: '350.00', overdue: '100.00', openSales: 2, nextDueDate: '2026-11-01' });
  });

  it('does not count the due day itself as overdue', () => {
    expect(creditBalance('c1', [sale({ dueDate: '2026-11-12' })], '2026-11-12').overdue).toBe('0.00');
  });
});
