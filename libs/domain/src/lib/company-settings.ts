/**
 * Per-company settings (HU-INV-06). Each key is typed here with its default, so code always has a value even when
 * the company has no `company_settings` row. Defaults follow the open client decisions (#32, #36, #37): a missing
 * threshold means the approval is never asked for.
 */
export interface CompanySettings {
  /** Prefix of the internal SKU (decision #32). */
  'inventory.skuPrefix': string;
  /** Whether a movement may leave a warehouse below zero (design-notes rule 2). */
  'inventory.allowNegativeStock': boolean;
  /** Most rows an Excel product import accepts (HU-INV-10). */
  'inventory.import.maxRows': number;
  /** Whether the import creates the brands it does not find (decision #33). Not supported yet: `true` is refused. */
  'inventory.import.createMissingBrands': boolean;
  /** Transfers above this many pieces need approval (decision #36). Null = no limit. */
  'transfers.approvalThresholdPieces': number | null;
  /** Transfers above this value need approval (decision #36). Null = no limit. */
  'transfers.approvalThresholdValue': string | null;
  /** Adjustments above this value need approval (decision #37). Null = no limit. */
  'adjustments.approvalThresholdValue': string | null;
}

export type CompanySettingKey = keyof CompanySettings;

export const COMPANY_SETTING_DEFAULTS: Readonly<CompanySettings> = {
  'inventory.skuPrefix': 'RL-',
  'inventory.allowNegativeStock': false,
  'inventory.import.maxRows': 2000,
  'inventory.import.createMissingBrands': false,
  'transfers.approvalThresholdPieces': null,
  'transfers.approvalThresholdValue': null,
  'adjustments.approvalThresholdValue': null,
};

/** Money thresholds are decimal strings, never JSON numbers (CLAUDE.md: money is never `number`). */
const MONEY_SETTING_KEYS: ReadonlySet<CompanySettingKey> = new Set<CompanySettingKey>([
  'transfers.approvalThresholdValue',
  'adjustments.approvalThresholdValue',
]);

/** Settings are read from the database as JSON; a value that does not match its type falls back to the default. */
export function settingOrDefault<K extends CompanySettingKey>(key: K, stored: unknown): CompanySettings[K] {
  const fallback = COMPANY_SETTING_DEFAULTS[key];
  if (stored === undefined || stored === null) return fallback;
  if (MONEY_SETTING_KEYS.has(key)) return (typeof stored === 'string' ? stored : fallback) as CompanySettings[K];
  if (typeof fallback === 'boolean') return (typeof stored === 'boolean' ? stored : fallback) as CompanySettings[K];
  if (typeof fallback === 'number') return (typeof stored === 'number' && Number.isInteger(stored) && stored > 0 ? stored : fallback) as CompanySettings[K];
  if (typeof fallback === 'string') return (typeof stored === 'string' ? stored : fallback) as CompanySettings[K];
  if (typeof stored === 'number' || typeof stored === 'string') return stored as CompanySettings[K];
  return fallback;
}
