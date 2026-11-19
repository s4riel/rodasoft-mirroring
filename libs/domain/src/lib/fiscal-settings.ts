/**
 * Fiscal configuration (HU-FAC-22…27): the digital signature and the SIAT credentials with their expiry, the points of sale, the
 * synced SIN catalogues, the SIN code of every product (homologation) and the switch to production.
 */
import type { CodeHealth, SiatConnectionStatus } from './invoicing';

// ── Expiry (HU-FAC-23) ──

/**
 * Health of the signature or the token by its expiry: `EXPIRED` once past it, `EXPIRING` inside the last `warnDays` days, `OK`
 * otherwise. A missing expiry is not judged here (the caller knows whether the thing exists), it counts as `OK`.
 */
export function expiryHealth(expiresAt: Date | string | null, now: Date, warnDays: number): CodeHealth {
  if (expiresAt === null) return 'OK';
  const left = new Date(expiresAt).getTime() - now.getTime();
  if (!(left > 0)) return 'EXPIRED';
  return left <= warnDays * 86_400_000 ? 'EXPIRING' : 'OK';
}

// ── Homologation (HU-FAC-26) ──

export interface HomologationProgress {
  total: number;
  done: number;
  pending: number;
  /** Whole percent of products with a SIN code; 0 when there are no products. */
  percent: number;
}

export function homologationProgress(total: number, done: number): HomologationProgress {
  const safeDone = Math.min(Math.max(done, 0), Math.max(total, 0));
  return { total, done: safeDone, pending: total - safeDone, percent: total > 0 ? Math.floor((safeDone * 100) / total) : 0 };
}

/** A product is homologated when it carries its SIN product code (the activity and unit come with it). */
export function isHomologated(product: { sinProductCode: string | null }): boolean {
  return product.sinProductCode !== null && product.sinProductCode.trim() !== '';
}

export const HOMOLOGATION_STATUSES = ['PENDING', 'DONE'] as const;
export type HomologationStatus = (typeof HOMOLOGATION_STATUSES)[number];

export function isHomologationStatus(value: unknown): value is HomologationStatus {
  return typeof value === 'string' && (HOMOLOGATION_STATUSES as readonly string[]).includes(value);
}

export interface HomologationRow {
  id: string;
  sku: string;
  code: string;
  name: string;
  brand: string | null;
  sinProductCode: string | null;
  sinActivityCode: string | null;
  sinUnitCode: number | null;
  /** Description of the SIN product code in the synced catalogue, when known. */
  sinDescription: string | null;
  status: HomologationStatus;
}

export interface HomologationListQuery {
  q?: string;
  status?: HomologationStatus;
  page?: number;
  pageSize?: number;
}

/** `GET invoicing/homologation`. The KPIs count every product, whatever the filter. */
export interface HomologationResponse {
  items: HomologationRow[];
  total: number;
  page: number;
  pageSize: number;
  progress: HomologationProgress;
  /** The SIN units of measure of the synced catalogue, for the unit select. */
  units: { code: number; description: string }[];
  catalogsSynced: boolean;
  /** Active products with no SIN unit of measure, and when the catalogues were last synced (null before the first sync). */
  withoutUnit: number;
  syncedAt: string | null;
}

export interface HomologationUpdateInput {
  sinProductCode: string;
  sinUnitCode?: number | null;
}

// ── Homologation import (HU-FAC-26) ──

export const HOMOLOGATION_IMPORT_MAX_ROWS = 2000;
/** Header of the import template, in order. */
export const HOMOLOGATION_IMPORT_COLUMNS = ['SKU', 'CODIGO_SIN', 'UNIDAD'] as const;

export type HomologationImportErrorCode = 'SKU_REQUIRED' | 'SKU_UNKNOWN' | 'SKU_DUPLICATED' | 'SIN_CODE_REQUIRED' | 'SIN_CODE_UNKNOWN' | 'UNIT_INVALID' | 'UNIT_UNKNOWN';

export const HOMOLOGATION_IMPORT_ERROR_LABELS: Record<HomologationImportErrorCode, string> = {
  SKU_REQUIRED: 'Falta el SKU',
  SKU_UNKNOWN: 'El SKU no existe',
  SKU_DUPLICATED: 'El SKU está repetido en el archivo',
  SIN_CODE_REQUIRED: 'Falta el código SIN',
  SIN_CODE_UNKNOWN: 'El código SIN no está en el catálogo sincronizado',
  UNIT_INVALID: 'La unidad no es un número',
  UNIT_UNKNOWN: 'La unidad no está en el catálogo sincronizado',
};

export interface HomologationImportRowResult {
  /** 1-based line of the file, header included. */
  line: number;
  sku: string;
  sinProductCode: string;
  unit: string;
  errors: HomologationImportErrorCode[];
}

export interface HomologationImportPreview {
  rows: HomologationImportRowResult[];
  total: number;
  valid: number;
  withErrors: number;
}

export interface HomologationImportResult {
  updated: number;
}

const LINE_BREAK = /\r?\n/;
/** A sheet gives tabs, a CSV commas or semicolons. */
const CELL_SEPARATOR = /\t|;|,/;

export interface HomologationImportRow {
  /** 1-based line of the file, header included. */
  line: number;
  sku: string;
  sinProductCode: string;
  unit: string;
}

/**
 * Reads the lines of an uploaded list (tab-separated, as `readListFile` returns them) into rows: SKU, SIN code and optional unit.
 * A first line whose first cell is "SKU" is the header and is skipped; empty lines are ignored but still count for the line number.
 */
export function parseHomologationLines(text: string): HomologationImportRow[] {
  const rows: HomologationImportRow[] = [];
  const lines = text.split(LINE_BREAK);
  lines.forEach((raw, index) => {
    if (raw.trim() === '') return;
    // a CSV uses commas or semicolons, a sheet gives tabs
    const cells = raw.split(CELL_SEPARATOR).map((cell) => cell.trim());
    if (rows.length === 0 && index === 0 && cells[0].toUpperCase() === HOMOLOGATION_IMPORT_COLUMNS[0]) return;
    rows.push({ line: index + 1, sku: cells[0] ?? '', sinProductCode: cells[1] ?? '', unit: cells[2] ?? '' });
  });
  return rows;
}

export interface HomologationImportLookups {
  /** SKUs of the company's products. */
  skus: ReadonlySet<string>;
  /** Codes of the synced product catalogue and of the unit-of-measure catalogue. */
  sinProductCodes: ReadonlySet<string>;
  unitCodes: ReadonlySet<string>;
}

/** What is wrong with each row of an import; a row without errors can be applied. */
export function validateHomologationRows(rows: readonly HomologationImportRow[], lookups: HomologationImportLookups): HomologationImportRowResult[] {
  const seen = new Set<string>();
  return rows.map((row): HomologationImportRowResult => {
    const errors: HomologationImportErrorCode[] = [];
    const sku = row.sku.trim().toUpperCase();
    if (sku === '') errors.push('SKU_REQUIRED');
    else if (!lookups.skus.has(sku)) errors.push('SKU_UNKNOWN');
    else if (seen.has(sku)) errors.push('SKU_DUPLICATED');
    if (sku !== '') seen.add(sku);
    if (row.sinProductCode.trim() === '') errors.push('SIN_CODE_REQUIRED');
    else if (!lookups.sinProductCodes.has(row.sinProductCode.trim())) errors.push('SIN_CODE_UNKNOWN');
    const unit = row.unit.trim();
    if (unit !== '') {
      if (!/^\d+$/.test(unit)) errors.push('UNIT_INVALID');
      else if (!lookups.unitCodes.has(unit)) errors.push('UNIT_UNKNOWN');
    }
    return { line: row.line, sku: row.sku.trim(), sinProductCode: row.sinProductCode.trim(), unit, errors };
  });
}

// ── Catalogues (HU-FAC-25) ──

export const SIAT_CATALOGS = ['ACTIVITY', 'LEGEND', 'PRODUCT_SERVICE', 'UNIT_OF_MEASURE', 'CANCELLATION_REASON', 'CREDIT_NOTE_REASON', 'POINT_OF_SALE_TYPE'] as const;
export type SiatCatalogKind = (typeof SIAT_CATALOGS)[number];

export function isSiatCatalogKind(value: unknown): value is SiatCatalogKind {
  return typeof value === 'string' && (SIAT_CATALOGS as readonly string[]).includes(value);
}

export const SIAT_CATALOG_LABELS: Record<SiatCatalogKind, string> = {
  ACTIVITY: 'Actividades económicas',
  LEGEND: 'Leyendas de facturas',
  PRODUCT_SERVICE: 'Productos y servicios',
  UNIT_OF_MEASURE: 'Unidades de medida',
  CANCELLATION_REASON: 'Motivos de anulación',
  CREDIT_NOTE_REASON: 'Motivos de nota de crédito-débito',
  POINT_OF_SALE_TYPE: 'Tipos de punto de venta',
};

export interface CatalogSummaryRow {
  catalog: SiatCatalogKind;
  entries: number;
  /** When it was last synced; null when it never was. */
  syncedAt: string | null;
}

/** `GET invoicing/catalogs`. */
export interface CatalogSummary {
  catalogs: CatalogSummaryRow[];
  /** Every catalogue has been synced at least once. */
  synced: boolean;
  syncedAt: string | null;
}

export interface CatalogEntryRow {
  code: string;
  description: string;
  activityCode: string;
  active: boolean;
}

export interface CatalogEntriesResponse {
  catalog: SiatCatalogKind;
  syncedAt: string | null;
  items: CatalogEntryRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CatalogEntriesQuery {
  q?: string;
  page?: number;
  pageSize?: number;
}

// ── Points of sale (HU-FAC-24) ──

export interface PointOfSaleListItem {
  id: string;
  branchId: string;
  branchName: string;
  /** The SIN point-of-sale code. */
  code: number;
  name: string;
  typeCode: number | null;
  registerName: string | null;
  /** Number of the last invoice issued at this point of sale; null when none was. */
  lastInvoiceNumber: number | null;
  cuisHealth: CodeHealth;
  cuisExpiresAt: string | null;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface PointOfSaleListKpis {
  total: number;
  active: number;
  /** Active points of sale whose CUIS is expired or missing. */
  withoutCuis: number;
}

export interface PointOfSaleListResponse {
  items: PointOfSaleListItem[];
  kpis: PointOfSaleListKpis;
  /** SIN point-of-sale types of the synced catalogue; falls back to the built-in two when it has not synced. */
  types: { code: number; description: string }[];
}

export interface CreatePointOfSaleInput {
  branchId: string;
  name: string;
  typeCode: number;
  /** Warehouse the new cash register sells from. */
  warehouseId: string;
}

/** The point-of-sale types of the SIN when the catalogue has not synced yet. */
export const POINT_OF_SALE_TYPES_DEFAULT: readonly { code: number; description: string }[] = [
  { code: 1, description: 'Comisionista' },
  { code: 5, description: 'Caja de sucursal' },
];

// ── Section status and checklist (HU-FAC-22) ──

export type FiscalSectionKey = 'SIGNATURE' | 'CREDENTIALS' | 'CONNECTION' | 'POINTS_OF_SALE' | 'CATALOGS' | 'ACTIVITY' | 'HOMOLOGATION';
export type FiscalSectionStatus = 'OK' | 'WARNING' | 'PENDING';

export interface FiscalChecklistRow {
  key: FiscalSectionKey;
  status: FiscalSectionStatus;
  /** A short fact the row shows (expiry date, counts); null when there is nothing to add. Spanish is built by the ERP. */
  detail: string | null;
}

export interface FiscalSignatureSummary {
  present: boolean;
  fileName: string | null;
  holder: string | null;
  uploadedAt: string | null;
  expiresAt: string | null;
  health: CodeHealth;
}

export interface FiscalCredentialsSummary {
  systemCode: string | null;
  /** Whether a token is stored; the token itself never leaves the API. */
  tokenPresent: boolean;
  tokenExpiresAt: string | null;
  tokenHealth: CodeHealth;
}

export interface FiscalActivitySummary {
  mainActivityCode: string | null;
  defaultProductCode: string | null;
}

/** `GET invoicing/fiscal-settings`: never carries a secret. */
export interface FiscalSettingsSummary {
  environment: 'PRODUCTION' | 'TEST';
  modality: string;
  gateway: 'SIMULATED' | 'SOAP';
  productionEnabledAt: string | null;
  warnDays: number;
  connection: { status: SiatConnectionStatus; checkedAt: string | null };
  signature: FiscalSignatureSummary;
  credentials: FiscalCredentialsSummary;
  activity: FiscalActivitySummary;
  pointsOfSale: { total: number; active: number; withCuis: number };
  catalogs: { synced: boolean; syncedAt: string | null };
  homologation: HomologationProgress;
  checklist: FiscalChecklistRow[];
  production: ProductionReadiness;
}

export interface SaveCredentialsInput {
  systemCode: string;
  token: string;
  tokenExpiresAt: string;
}

export interface SaveActivityInput {
  mainActivityCode: string;
  defaultProductCode: string;
}

// ── Production (HU-FAC-27) ──

/** The text the person types to confirm the switch. */
export const PRODUCTION_CONFIRMATION = 'PRODUCCIÓN';

export type ProductionRequirementCode =
  | 'SIGNATURE_MISSING'
  | 'SIGNATURE_EXPIRED'
  | 'CREDENTIALS_MISSING'
  | 'TOKEN_EXPIRED'
  | 'CONNECTION_OFFLINE'
  | 'POINT_OF_SALE_MISSING'
  | 'CATALOGS_NOT_SYNCED'
  | 'ACTIVITY_MISSING'
  | 'PRODUCTS_NOT_HOMOLOGATED'
  | 'GATEWAY_SIMULATED';

export const PRODUCTION_REQUIREMENT_LABELS: Record<ProductionRequirementCode, string> = {
  SIGNATURE_MISSING: 'Falta cargar la firma digital',
  SIGNATURE_EXPIRED: 'La firma digital está vencida',
  CREDENTIALS_MISSING: 'Faltan el código de sistema y el token del SIAT',
  TOKEN_EXPIRED: 'El token del SIAT está vencido',
  CONNECTION_OFFLINE: 'No hay conexión con el SIAT',
  POINT_OF_SALE_MISSING: 'Falta un punto de venta con CUIS vigente',
  CATALOGS_NOT_SYNCED: 'Faltan sincronizar los catálogos del SIN',
  ACTIVITY_MISSING: 'Falta elegir la actividad económica principal',
  PRODUCTS_NOT_HOMOLOGATED: 'Hay productos sin código SIN',
  GATEWAY_SIMULATED: 'El SIAT todavía es el simulador',
};

export interface ProductionReadinessInput {
  /** `ELECTRONIC_ONLINE` signs every invoice, so it needs the signature. */
  modality: string;
  signature: { present: boolean; health: CodeHealth };
  credentials: { systemCodePresent: boolean; tokenPresent: boolean; tokenHealth: CodeHealth };
  connection: SiatConnectionStatus;
  /** Active points of sale holding a current CUIS. */
  pointsOfSaleWithCuis: number;
  catalogsSynced: boolean;
  mainActivityChosen: boolean;
  /** Active products that still have no SIN code. */
  productsPending: number;
  /** The gateway in use is the simulator, and whether the deployment allows going live with it. */
  simulatedGateway: boolean;
  simulatorAllowed: boolean;
}

export interface ProductionReadiness {
  ready: boolean;
  requirements: ProductionRequirementCode[];
}

/** What is still missing before the company can invoice for real; `ready` when nothing is. */
export function productionReadiness(input: ProductionReadinessInput): ProductionReadiness {
  const requirements: ProductionRequirementCode[] = [];
  if (input.modality === 'ELECTRONIC_ONLINE') {
    if (!input.signature.present) requirements.push('SIGNATURE_MISSING');
    else if (input.signature.health === 'EXPIRED') requirements.push('SIGNATURE_EXPIRED');
  }
  if (!input.credentials.systemCodePresent || !input.credentials.tokenPresent) requirements.push('CREDENTIALS_MISSING');
  else if (input.credentials.tokenHealth === 'EXPIRED') requirements.push('TOKEN_EXPIRED');
  if (input.connection !== 'ONLINE') requirements.push('CONNECTION_OFFLINE');
  if (input.pointsOfSaleWithCuis < 1) requirements.push('POINT_OF_SALE_MISSING');
  if (!input.catalogsSynced) requirements.push('CATALOGS_NOT_SYNCED');
  if (!input.mainActivityChosen) requirements.push('ACTIVITY_MISSING');
  if (input.productsPending > 0) requirements.push('PRODUCTS_NOT_HOMOLOGATED');
  if (input.simulatedGateway && !input.simulatorAllowed) requirements.push('GATEWAY_SIMULATED');
  return { ready: requirements.length === 0, requirements };
}

/** Whether what the person typed is the confirmation word, exactly. */
export function isProductionConfirmation(typed: unknown): boolean {
  return typed === PRODUCTION_CONFIRMATION;
}
