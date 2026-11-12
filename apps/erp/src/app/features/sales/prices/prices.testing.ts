import type { PriceChangeEntry, PriceDetail, PriceListResponse, PriceListRow } from '@rodasoft/domain';

/** Shared data of the prices specs (HU-VEN-26). */
export function priceChange(over: Partial<PriceChangeEntry> = {}): PriceChangeEntry {
  return {
    id: 'c1',
    at: '2026-10-14T15:00:00.000Z',
    by: { id: 'u5', name: 'Gabriela Gerente' },
    source: 'MANUAL',
    oldPrice: '235.00',
    newPrice: '245.00',
    percent: '4.3',
    reason: null,
    ...over,
  };
}

export function priceRow(over: Partial<PriceListRow> = {}): PriceListRow {
  return {
    productId: 'p1',
    sku: 'RL-000001',
    manufacturerCode: '6205-2RS',
    name: 'Rodamiento rígido de bolas',
    brand: { id: 'b1', name: 'SKF' },
    country: { code: 'SE', name: 'Suecia' },
    photo: null,
    status: 'ACTIVE',
    salePrice: '245.00',
    hasPrice: true,
    branchStock: 12,
    lastChange: priceChange(),
    ...over,
  };
}

export function priceList(over: Partial<PriceListResponse> = {}): PriceListResponse {
  const items = [
    priceRow(),
    priceRow({
      productId: 'p2',
      sku: 'RL-000002',
      manufacturerCode: '6206-ZZ',
      name: 'Rodamiento con tapas',
      country: null,
      salePrice: '0.00',
      hasPrice: false,
      branchStock: 0,
      lastChange: null,
    }),
  ];
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 20,
    kpis: { products: 40, withPrice: 37, withoutPrice: 3, changesThisMonth: 5 },
    branch: { id: 'br1', name: 'Huayna Kapac' },
    brands: [
      { id: 'b1', name: 'SKF' },
      { id: 'b2', name: 'FAG' },
    ],
    categories: [{ id: 'c1', name: 'Rodamientos' }],
    ...over,
  };
}

/** The product of the dialog, as someone without `inventory.costs.view` gets it. */
export function priceDetail(over: Partial<PriceDetail> = {}): PriceDetail {
  return {
    productId: 'p1',
    sku: 'RL-000001',
    manufacturerCode: '6205-2RS',
    name: 'Rodamiento rígido de bolas',
    brand: { id: 'b1', name: 'SKF' },
    salePrice: '245.00',
    changes: [priceChange()],
    ...over,
  };
}
