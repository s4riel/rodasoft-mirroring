import { expiryHealth, homologationProgress, parseHomologationLines, validateHomologationRows, isHomologated, isProductionConfirmation, isSiatCatalogKind, productionReadiness, type ProductionReadinessInput } from './fiscal-settings';

describe('expiryHealth', () => {
  const now = new Date('2026-11-17T12:00:00Z');
  it('is OK far from the expiry, EXPIRING inside the warning days, EXPIRED after', () => {
    expect(expiryHealth('2027-03-01T00:00:00Z', now, 30)).toBe('OK');
    expect(expiryHealth('2026-12-10T00:00:00Z', now, 30)).toBe('EXPIRING');
    expect(expiryHealth('2026-12-17T12:00:00Z', now, 30)).toBe('EXPIRING');
    expect(expiryHealth('2026-12-17T12:00:01Z', now, 30)).toBe('OK');
    expect(expiryHealth('2026-11-17T12:00:00Z', now, 30)).toBe('EXPIRED');
    expect(expiryHealth(new Date('2026-01-01T00:00:00Z'), now, 30)).toBe('EXPIRED');
  });
  it('does not judge a missing expiry', () => {
    expect(expiryHealth(null, now, 30)).toBe('OK');
  });
});

describe('homologationProgress', () => {
  it('counts pending and the whole percent', () => {
    expect(homologationProgress(8, 6)).toEqual({ total: 8, done: 6, pending: 2, percent: 75 });
    expect(homologationProgress(3, 1).percent).toBe(33);
    expect(homologationProgress(0, 0)).toEqual({ total: 0, done: 0, pending: 0, percent: 0 });
  });
  it('never counts more done than products', () => {
    expect(homologationProgress(2, 5)).toEqual({ total: 2, done: 2, pending: 0, percent: 100 });
  });
  it('a product with a SIN code is homologated', () => {
    expect(isHomologated({ sinProductCode: '84311' })).toBe(true);
    expect(isHomologated({ sinProductCode: null })).toBe(false);
    expect(isHomologated({ sinProductCode: '  ' })).toBe(false);
  });
});

describe('productionReadiness', () => {
  const ready: ProductionReadinessInput = {
    modality: 'ELECTRONIC_ONLINE',
    signature: { present: true, health: 'OK' },
    credentials: { systemCodePresent: true, tokenPresent: true, tokenHealth: 'OK' },
    connection: 'ONLINE',
    pointsOfSaleWithCuis: 1,
    catalogsSynced: true,
    mainActivityChosen: true,
    productsPending: 0,
    simulatedGateway: false,
    simulatorAllowed: false,
  };
  it('is ready when nothing is missing', () => {
    expect(productionReadiness(ready)).toEqual({ ready: true, requirements: [] });
  });
  it('lists every missing requirement in order', () => {
    const result = productionReadiness({
      modality: 'ELECTRONIC_ONLINE',
      signature: { present: false, health: 'OK' },
      credentials: { systemCodePresent: false, tokenPresent: false, tokenHealth: 'OK' },
      connection: 'OFFLINE',
      pointsOfSaleWithCuis: 0,
      catalogsSynced: false,
      mainActivityChosen: false,
      productsPending: 3,
      simulatedGateway: true,
      simulatorAllowed: false,
    });
    expect(result.ready).toBe(false);
    expect(result.requirements).toEqual([
      'SIGNATURE_MISSING',
      'CREDENTIALS_MISSING',
      'CONNECTION_OFFLINE',
      'POINT_OF_SALE_MISSING',
      'CATALOGS_NOT_SYNCED',
      'ACTIVITY_MISSING',
      'PRODUCTS_NOT_HOMOLOGATED',
      'GATEWAY_SIMULATED',
    ]);
  });
  it('expired signature and token are refused', () => {
    expect(productionReadiness({ ...ready, signature: { present: true, health: 'EXPIRED' } }).requirements).toEqual(['SIGNATURE_EXPIRED']);
    expect(productionReadiness({ ...ready, credentials: { systemCodePresent: true, tokenPresent: true, tokenHealth: 'EXPIRED' } }).requirements).toEqual(['TOKEN_EXPIRED']);
  });
  it('an expiring signature still lets the company go live', () => {
    expect(productionReadiness({ ...ready, signature: { present: true, health: 'EXPIRING' } }).ready).toBe(true);
  });
  it('the computerized modality does not need the signature', () => {
    expect(productionReadiness({ ...ready, modality: 'COMPUTERIZED_ONLINE', signature: { present: false, health: 'OK' } }).ready).toBe(true);
  });
  it('the simulator blocks production unless the deployment allows it', () => {
    expect(productionReadiness({ ...ready, simulatedGateway: true }).requirements).toEqual(['GATEWAY_SIMULATED']);
    expect(productionReadiness({ ...ready, simulatedGateway: true, simulatorAllowed: true }).ready).toBe(true);
  });
});

describe('confirmation and catalogues', () => {
  it('asks for the exact word', () => {
    expect(isProductionConfirmation('PRODUCCIÓN')).toBe(true);
    expect(isProductionConfirmation('produccion')).toBe(false);
    expect(isProductionConfirmation('PRODUCCION')).toBe(false);
    expect(isProductionConfirmation(' PRODUCCIÓN')).toBe(false);
    expect(isProductionConfirmation(undefined)).toBe(false);
  });
  it('knows its catalogues', () => {
    expect(isSiatCatalogKind('LEGEND')).toBe(true);
    expect(isSiatCatalogKind('OTHER')).toBe(false);
  });
});

describe('homologation import', () => {
  const lookups = { skus: new Set(['RL-000001', 'RL-000002']), sinProductCodes: new Set(['84821', '40169']), unitCodes: new Set(['58', '62']) };

  it('reads tab, comma and semicolon separated lines, skipping the header and the empty lines', () => {
    const text = ['SKU\tCODIGO_SIN\tUNIDAD', '', 'RL-000001\t84821\t58', 'RL-000002;40169', ''].join('\n');
    expect(parseHomologationLines(text)).toEqual([
      { line: 3, sku: 'RL-000001', sinProductCode: '84821', unit: '58' },
      { line: 4, sku: 'RL-000002', sinProductCode: '40169', unit: '' },
    ]);
  });

  it('keeps a first line that is not a header', () => {
    expect(parseHomologationLines('RL-000001,84821')).toEqual([{ line: 1, sku: 'RL-000001', sinProductCode: '84821', unit: '' }]);
  });

  it('accepts a known SKU with a known code and, when given, a known unit', () => {
    const rows = validateHomologationRows(parseHomologationLines('rl-000001\t84821\t58'), lookups);
    expect(rows[0].errors).toEqual([]);
  });

  it('reports every problem of a row', () => {
    const [row] = validateHomologationRows([{ line: 2, sku: '', sinProductCode: '', unit: 'x' }], lookups);
    expect(row.errors).toEqual(['SKU_REQUIRED', 'SIN_CODE_REQUIRED', 'UNIT_INVALID']);
    const [unknown] = validateHomologationRows([{ line: 2, sku: 'NOPE', sinProductCode: '00000', unit: '99' }], lookups);
    expect(unknown.errors).toEqual(['SKU_UNKNOWN', 'SIN_CODE_UNKNOWN', 'UNIT_UNKNOWN']);
  });

  it('marks the second appearance of a SKU as duplicated', () => {
    const rows = validateHomologationRows(parseHomologationLines('RL-000001\t84821\nRL-000001\t40169'), lookups);
    expect(rows.map((row) => row.errors)).toEqual([[], ['SKU_DUPLICATED']]);
  });
});
