import { EMPTY_SALES_LINE_SPEC } from './sales-line-spec';
import { buildReceiptLines, creditDueText, formatDay, formatDayShort, formatReceiptDate, receiptShareText, type SaleReceipt } from './sale-receipt';

const receipt: SaleReceipt = {
  saleId: 'sale-1',
  number: 'V-000125',
  createdAt: '2026-10-14T14:42:00.000Z',
  company: { tradeName: 'Rodalaser', legalName: 'Rodalaser S.R.L.', nit: '1020304050' },
  branch: { name: 'Sucursal central' },
  cashier: { name: 'Alberto Andia' },
  customer: { name: 'Taller Mecánico Perez', documentType: 1, documentNumber: '4455667788', complement: null, email: null },
  lines: [
    { code: '6205-2RS', name: 'Rodamiento rígido de bolas', quantity: 2, unitPrice: '245.00', lineTotal: '490.00', spec: EMPTY_SALES_LINE_SPEC },
    { code: '6306-2RS', name: 'Rodamiento rígido de bolas', quantity: 1, unitPrice: '361.00', lineTotal: '361.00', spec: EMPTY_SALES_LINE_SPEC },
  ],
  subtotal: '851.00',
  discountType: 'NONE',
  discountAmount: '0.00',
  roundingAmount: '0.00',
  total: '851.00',
  payments: [{ method: 'CASH', amount: '851.00', change: '49.00', dueDate: null }],
  invoiceStatus: 'PENDING',
  format: 'TICKET_80MM',
};

describe('formatReceiptDate', () => {
  it('prints the instant in La Paz time (UTC−4)', () => {
    expect(formatReceiptDate('2026-10-14T14:42:00.000Z')).toBe('14/10/2026 10:42');
  });

  it('rolls the day back after midnight UTC', () => {
    expect(formatReceiptDate('2026-01-01T02:05:00.000Z')).toBe('31/12/2025 22:05');
  });
});

describe('buildReceiptLines', () => {
  it('formats each line in the Bolivian style', () => {
    expect(buildReceiptLines(receipt.lines)).toEqual([
      { description: '6205-2RS · Rodamiento rígido de bolas', detail: '2 × Bs 245,00', total: 'Bs 490,00' },
      { description: '6306-2RS · Rodamiento rígido de bolas', detail: '1 × Bs 361,00', total: 'Bs 361,00' },
    ]);
  });

  it('groups thousands with a dot', () => {
    const [line] = buildReceiptLines([{ code: 'X', name: 'Y', quantity: 3, unitPrice: '1200.00', lineTotal: '3600.00', spec: EMPTY_SALES_LINE_SPEC }]);
    expect(line.total).toBe('Bs 3.600,00');
  });
});

describe('receiptShareText', () => {
  const text = receiptShareText(receipt);

  it('has the number, date, lines and total', () => {
    expect(text).toContain('Comprobante V-000125');
    expect(text).toContain('14/10/2026 10:42');
    expect(text).toContain('6205-2RS · Rodamiento rígido de bolas: 2 × Bs 245,00 = Bs 490,00');
    expect(text).toContain('Total: Bs 851,00');
  });

  it('never shows the customer NIT or any cost', () => {
    expect(text).not.toContain('4455667788');
    expect(text.toLowerCase()).not.toContain('cost');
  });
});

describe('creditDueText (HU-VEN-34)', () => {
  it('writes the due date of the credit panel with a short month', () => {
    expect(formatDayShort('2026-11-21')).toBe('21 nov 2026');
    expect(formatDayShort('2027-01-04')).toBe('4 ene 2027');
  });

  it('writes the credit payment with its due date in Bolivian format', () => {
    expect(creditDueText('2026-11-21')).toBe('Crédito · vence 21/11/2026');
    expect(formatDay('2027-01-04')).toBe('04/01/2027');
  });
});
