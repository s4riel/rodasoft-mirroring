import type { KardexLedgerRow, KardexResponse, KardexRow } from '@rodasoft/domain';
import {
  columnsOf,
  counterpartText,
  documentOf,
  hasLedgerFilters,
  kardexErrorMessage,
  KARDEX_PAGE_SIZE,
  KardexUrlFilters,
  ledgerColumnsOf,
  ledgerDocumentRoute,
  ledgerMenuOf,
  LEDGER_PILLS,
  ledgerTotalsRow,
  movementText,
  openingRow,
  parseDay,
  parseType,
  rangeLabel,
  shownRange,
  toLedgerRow,
  toQuery,
  toRow,
  totalsRow,
  TYPE_OPTIONS,
} from './kardex.mapper';

const row = (over: Partial<KardexRow> = {}): KardexRow => ({
  id: 'm1',
  date: '2026-10-12T16:00:00.000Z',
  type: 'SALE',
  typeLabel: 'Venta',
  document: { refType: 'SALE', refNumber: 'V-00231' },
  branch: { id: 'b1', name: 'Huayna Kapac' },
  warehouse: { id: 'w1', name: 'Principal' },
  user: 'Ana',
  quantityIn: 0,
  quantityOut: 4,
  balance: 26,
  warehouseBalance: 26,
  ...over,
});

describe('parseDay', () => {
  it('keeps a plain day and drops anything else', () => {
    expect(parseDay('2026-10-01')).toBe('2026-10-01');
    expect(parseDay('01/10/2026')).toBeNull();
    expect(parseDay(null)).toBeNull();
  });
});

describe('shownRange', () => {
  it('shows the current month when the URL has no dates', () => {
    expect(shownRange({ from: null, to: null }, new Date('2026-10-15T15:00:00Z'))).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('keeps what the URL has', () => {
    expect(shownRange({ from: '2026-09-05', to: null }, new Date('2026-10-15T15:00:00Z'))).toEqual({ from: '2026-09-05', to: '2026-10-31' });
  });
});

const FILTERS: KardexUrlFilters = { productId: null, warehouseId: null, branchId: null, type: null, q: '', from: null, to: null, page: 1 };

describe('toQuery', () => {
  it('asks for the ledger of every movement while no product is picked', () => {
    expect(toQuery(FILTERS)).toEqual({ page: 1, pageSize: KARDEX_PAGE_SIZE });
  });

  it('sends the branch, type and search text of the ledger', () => {
    // a warehouse left in the URL is not a ledger filter: the ledger has no control for it
    expect(toQuery({ ...FILTERS, branchId: 'b1', type: 'SALE', q: 'TR-0031', warehouseId: 'w1', from: '2026-10-01' })).toEqual({
      branchId: 'b1',
      type: 'SALE',
      q: 'TR-0031',
      from: '2026-10-01',
      page: 1,
      pageSize: KARDEX_PAGE_SIZE,
    });
  });

  it('sends only the warehouse and dates of the URL, the page and the page size for a product', () => {
    expect(toQuery({ ...FILTERS, productId: 'p1', warehouseId: 'w1', from: '2026-10-01', page: 2, type: 'SALE', q: 'x' })).toEqual({
      productId: 'p1',
      warehouseId: 'w1',
      from: '2026-10-01',
      to: undefined,
      page: 2,
      pageSize: KARDEX_PAGE_SIZE,
    });
  });
});

describe('parseType and hasLedgerFilters', () => {
  it('keeps a real movement type and drops anything else', () => {
    expect(parseType('SALE')).toBe('SALE');
    expect(parseType('GIFT')).toBeNull();
    expect(parseType(null)).toBeNull();
  });

  it('lists the eight movement types in the filter', () => {
    expect(TYPE_OPTIONS).toHaveLength(8);
    expect(TYPE_OPTIONS.find((o) => o.value === 'ADJUSTMENT_OUT')?.label).toBe('Ajuste (−)');
  });

  it('tells whether "Limpiar" has anything to clear', () => {
    expect(hasLedgerFilters(FILTERS)).toBe(false);
    expect(hasLedgerFilters({ ...FILTERS, q: 'x' })).toBe(true);
    expect(hasLedgerFilters({ ...FILTERS, from: '2026-10-01' })).toBe(true);
  });
});

const ledgerRow = (over: Partial<KardexLedgerRow> = {}): KardexLedgerRow => ({
  id: 'm1',
  date: '2026-10-12T16:00:00.000Z',
  type: 'TRANSFER_OUT',
  typeLabel: 'Salida por transferencia',
  pill: 'TRANSFER',
  document: { refType: 'TRANSFER', refNumber: 'TR-0031' },
  documentLink: { kind: 'TRANSFER', id: 't1' },
  product: { id: 'p1', manufacturerCode: '6205-2RS', name: 'Rodamiento', brand: 'SKF' },
  branch: { id: 'b1', name: 'Huayna Kapac' },
  warehouse: { id: 'w1', name: 'Principal' },
  counterpart: { direction: 'TO', branch: 'Sacaba', warehouse: 'Principal', inTransit: true },
  user: 'Ana',
  quantity: -12,
  balance: 12,
  ...over,
});

describe('ledger rows', () => {
  it('writes the movement, its location, the signed quantity and the balance of the warehouse', () => {
    const r = toLedgerRow(ledgerRow(), false);
    expect(r.cells).toMatchObject({ product: '6205-2RS', movement: 'Salida por transferencia TR-0031', detail: 'Huayna Kapac · Principal', quantity: '−12', balance: 12 });
    expect(r.cells['pill']).toEqual(LEDGER_PILLS.TRANSFER);
    expect(r.cells).not.toHaveProperty('unitCost');
  });

  it('colors an inflow as success and an outflow as warning', () => {
    expect(LEDGER_PILLS.IN.status).toBe('success');
    expect(LEDGER_PILLS.OUT.status).toBe('warning');
    expect(LEDGER_PILLS.TRANSFER.label).toBe('Transferencia');
  });

  it('adds the cost columns only with costs, and a dash when the movement has none', () => {
    expect(ledgerColumnsOf(false).map((c) => c.label)).toEqual(['Fecha', 'Producto', 'Movimiento', 'Detalle', 'Cantidad', 'Saldo', 'Tipo', '']);
    expect(ledgerColumnsOf(true).map((c) => c.label)).toEqual(['Fecha', 'Producto', 'Movimiento', 'Detalle', 'Cantidad', 'Saldo', 'Costo unit.', 'Valor', 'Tipo', '']);
    expect(toLedgerRow(ledgerRow({ unitCost: null, value: null }), true).cells).toMatchObject({ unitCost: '–', value: '–' });
    expect(toLedgerRow(ledgerRow({ unitCost: '2.5000', value: '10.00' }), true).cells['value']).toContain('10,00');
  });

  it('names a movement without a document by its type alone', () => {
    expect(movementText(ledgerRow({ typeLabel: 'Inventario inicial', document: { refType: null, refNumber: null } }))).toBe('Inventario inicial');
  });

  it('says where a transfer goes and nothing for any other movement', () => {
    expect(counterpartText(ledgerRow())).toBe('Hacia Sacaba · Principal · en tránsito');
    expect(counterpartText(ledgerRow({ counterpart: null }))).toBe('');
  });

  it('totals the movements and what they net out to', () => {
    const totals = ledgerTotalsRow({ total: 3, totals: { quantityIn: 30, quantityOut: 18, net: 12 }, includesCost: false });
    expect(totals).toMatchObject({ date: 'Total', movement: '3 movimientos', quantity: '+12', balance: '–' });
  });

  it('offers the document only when there is one, and always the kardex of the product', () => {
    expect(ledgerMenuOf(ledgerRow()).map((i) => i.key)).toEqual(['document', 'product']);
    expect(ledgerMenuOf(ledgerRow({ documentLink: null })).map((i) => i.key)).toEqual(['product']);
    expect(ledgerDocumentRoute(ledgerRow())).toBe('/inventory/transfers/t1');
    expect(ledgerDocumentRoute(ledgerRow({ documentLink: null }))).toBeNull();
  });
});

describe('columnsOf', () => {
  it('adds the cost columns only when the member sees costs', () => {
    expect(columnsOf(false).map((c) => c.label)).toEqual(['Fecha', 'Tipo', 'Documento', 'Almacén', 'Usuario', 'Entrada', 'Salida', 'Saldo']);
    expect(columnsOf(true).map((c) => c.label)).toEqual(['Fecha', 'Tipo', 'Documento', 'Almacén', 'Usuario', 'Entrada', 'Salida', 'Saldo', 'Costo unit.', 'Valor']);
  });
});

describe('toRow', () => {
  it('writes an outflow in the Salida column and leaves Entrada empty', () => {
    const r = toRow(row(), false);
    expect(r.cells).toMatchObject({ type: 'Venta', document: 'V-00231', warehouse: 'Huayna Kapac · Principal', user: 'Ana', in: '', out: 4, balance: 26 });
    expect(r.cells).not.toHaveProperty('unitCost');
  });

  it('writes an inflow in the Entrada column', () => {
    expect(toRow(row({ type: 'PURCHASE_RECEIPT', quantityIn: 30, quantityOut: 0 }), false).cells).toMatchObject({ in: 30, out: '' });
  });

  it('shows the value of the movement and a dash when it has no cost', () => {
    const valued = toRow(row({ unitCost: '5.0000', valueOut: '20.00', valueIn: null }), true);
    expect(valued.cells['unitCost']).toContain('5,00');
    expect(valued.cells['value']).toContain('20,00');
    const unvalued = toRow(row({ unitCost: null, valueOut: null, valueIn: null }), true);
    expect(unvalued.cells).toMatchObject({ unitCost: '–', value: '–' });
  });

  it('names a user-less movement with a dash', () => {
    expect(toRow(row({ user: null }), false).cells['user']).toBe('–');
  });
});

describe('documentOf', () => {
  it('prefers the document number, then its type, then a dash', () => {
    expect(documentOf({ document: { refType: 'SALE', refNumber: 'V-1' } })).toBe('V-1');
    expect(documentOf({ document: { refType: 'SALE', refNumber: null } })).toBe('SALE');
    expect(documentOf({ document: { refType: null, refNumber: null } })).toBe('–');
  });
});

describe('openingRow and totalsRow', () => {
  it('opens with the balance before the range', () => {
    expect(openingRow(60, false)).toMatchObject({ id: 'opening', cells: { type: 'Saldo inicial', balance: 60 } });
  });

  it('closes with the totals of the whole range', () => {
    const response = { totals: { quantityIn: 15, quantityOut: 20, closingBalance: 55 }, includesCost: true } as KardexResponse;
    expect(totalsRow(response)).toMatchObject({ date: 'Saldo final', in: 15, out: 20, balance: 55, unitCost: '', value: '' });
  });
});

describe('rangeLabel', () => {
  it('is empty without movements and counts the page otherwise', () => {
    expect(rangeLabel(1, 0, 0)).toBe('');
    expect(rangeLabel(1, 1, 1)).toBe('1–1 de 1 movimiento');
    expect(rangeLabel(2, 25, 80)).toBe('26–50 de 80 movimientos');
  });
});

describe('kardexErrorMessage', () => {
  it('words the warehouse error for the kardex and falls back to the server message', () => {
    expect(kardexErrorMessage({ code: 'WAREHOUSE_NOT_FOUND', message: 'Warehouse not found' })).toContain('almacén');
    expect(kardexErrorMessage({ code: 'OTHER', message: 'Boom' })).toBe('Boom');
  });
});
