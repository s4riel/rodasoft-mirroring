import { ROUNDING_MODES, type RoundingMode } from './sales-pricing';

/** How the customer's NIT is checked before invoicing: its format only, or also online with the SIN (HU-FAC). */
export const NIT_VERIFICATION_MODES = ['FORMAT', 'SIAT'] as const;
export type NitVerificationMode = (typeof NIT_VERIFICATION_MODES)[number];

/** Paper of the sale receipt (decision #9): the 80 mm ticket roll or a letter-size page. */
export const RECEIPT_FORMATS = ['TICKET_80MM', 'LETTER'] as const;
export type ReceiptFormat = (typeof RECEIPT_FORMATS)[number];

/**
 * Per-company settings (HU-INV-06). Each key is typed here with its default, so code always has a value even when
 * the company has no `company_settings` row. Defaults follow the open client decisions (#32, #37): a missing
 * threshold means the approval is never asked for. Transfers have no approval step, so no threshold.
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
  /** Whether an equivalence link must be approved before it counts (decision #34). Off: it is saved approved, with audit. */
  'inventory.equivalences.requireApproval': boolean;
  /** Most distinct products one transfer may carry (HU-INV-18). */
  'transfers.maxLines': number;
  /** Adjustments above this value need approval (decision #37). Null = no limit. */
  'adjustments.approvalThresholdValue': string | null;
  /** Rounding of the sale total (decision #54). */
  'sales.roundingMode': RoundingMode;
  /** Whether a sale may be paid with more than one method (decision #7). */
  'sales.allowMixedPayment': boolean;
  /** Days a quote stays valid (decision #12). */
  'sales.quoteValidityDays': number;
  /** Whether an order may be dispatched and invoiced in parts (decision #14). */
  'sales.allowPartialDispatch': boolean;
  /** Days after a sale in which it can still be cancelled (decision #10). Null = no limit. */
  'sales.cancellationWindowDays': number | null;
  /** Cash expenses above this value need approval (decision #16). Null = never asks. */
  'sales.cashExpenseApprovalLimit': string | null;
  /** A cash difference beyond this amount (either way) needs Accounting review (decision #17, HU-VEN-23). `"0.00"`: any difference does. */
  'sales.cashDifferenceTolerance': string;
  /** Returns above this value need approval (decision #15, HU-VEN-21). Null = never asks. */
  'sales.returnApprovalLimit': string | null;
  /** Days after a sale in which it can still be returned (decision #15). Null = no limit. */
  'sales.returnWindowDays': number | null;
  /** How the NIT is verified before invoicing (HU-VEN-05). `SIAT` waits for the invoicing epic; until then only the format is checked. */
  'sales.nitVerification': NitVerificationMode;
  /** Paper the sale receipt prints on (decision #9, HU-VEN-11). */
  'sales.receiptFormat': ReceiptFormat;
  /** Seconds a QR payment waits for the customer before the server cancels it (decision #6, HU-VEN-08). */
  'sales.qrConfirmTimeoutSeconds': number;
  /** Whether the POS offers card payments (decision #8, HU-VEN-10): off for a company without a terminal. */
  'sales.cardPaymentEnabled': boolean;
  /** Whether a bulk price update needs approval before it applies (decision #19, HU-VEN-27). On: applying is refused until the approval flow exists. */
  'sales.bulkPriceRequiresApproval': boolean;
  /** Payment terms (days) the POS offers for a credit sale, besides "other" (decision #53, HU-VEN-34). */
  'sales.creditTermDays': number[];
}

export type CompanySettingKey = keyof CompanySettings;

export const COMPANY_SETTING_DEFAULTS: Readonly<CompanySettings> = {
  'inventory.skuPrefix': 'RL-',
  'inventory.allowNegativeStock': false,
  'inventory.import.maxRows': 2000,
  'inventory.import.createMissingBrands': false,
  'inventory.equivalences.requireApproval': false,
  'transfers.maxLines': 500,
  'adjustments.approvalThresholdValue': null,
  'sales.roundingMode': 'NONE',
  'sales.allowMixedPayment': true,
  'sales.quoteValidityDays': 7,
  'sales.allowPartialDispatch': true,
  'sales.cancellationWindowDays': null,
  'sales.cashExpenseApprovalLimit': null,
  'sales.cashDifferenceTolerance': '0.00',
  'sales.returnApprovalLimit': null,
  'sales.returnWindowDays': null,
  'sales.nitVerification': 'FORMAT',
  'sales.receiptFormat': 'TICKET_80MM',
  'sales.qrConfirmTimeoutSeconds': 300,
  'sales.cardPaymentEnabled': true,
  'sales.bulkPriceRequiresApproval': false,
  'sales.creditTermDays': [5, 15, 30],
};

/** Money thresholds are decimal strings, never JSON numbers (CLAUDE.md: money is never `number`). */
const MONEY_SETTING_KEYS: ReadonlySet<CompanySettingKey> = new Set<CompanySettingKey>([
  'adjustments.approvalThresholdValue',
  'sales.cashExpenseApprovalLimit',
  'sales.cashDifferenceTolerance',
  'sales.returnApprovalLimit',
]);

/** Settings whose value is one of a closed list. */
const ENUM_SETTING_VALUES: Partial<Record<CompanySettingKey, readonly string[]>> = {
  'sales.roundingMode': ROUNDING_MODES,
  'sales.nitVerification': NIT_VERIFICATION_MODES,
  'sales.receiptFormat': RECEIPT_FORMATS,
};

/** Settings that are a positive whole number or null (null = no limit); their default is null, so the type is not inferable from it. */
const NULLABLE_INTEGER_SETTING_KEYS: ReadonlySet<CompanySettingKey> = new Set<CompanySettingKey>(['sales.cancellationWindowDays', 'sales.returnWindowDays']);

const isPositiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;

/** Settings are read from the database as JSON; a value that does not match its type falls back to the default. */
export function settingOrDefault<K extends CompanySettingKey>(key: K, stored: unknown): CompanySettings[K] {
  const fallback = COMPANY_SETTING_DEFAULTS[key];
  if (stored === undefined || stored === null) return fallback;
  if (MONEY_SETTING_KEYS.has(key)) return (typeof stored === 'string' ? stored : fallback) as CompanySettings[K];
  const allowed = ENUM_SETTING_VALUES[key];
  if (allowed) return (typeof stored === 'string' && allowed.includes(stored) ? stored : fallback) as CompanySettings[K];
  if (NULLABLE_INTEGER_SETTING_KEYS.has(key)) return (isPositiveInteger(stored) ? stored : fallback) as CompanySettings[K];
  if (Array.isArray(fallback)) {
    // a list of positive whole numbers, without repeats and in ascending order; anything else falls back to the default
    const valid = Array.isArray(stored) && stored.length > 0 && stored.every(isPositiveInteger);
    return (valid ? [...new Set(stored as number[])].sort((a, b) => a - b) : fallback) as CompanySettings[K];
  }
  if (typeof fallback === 'boolean') return (typeof stored === 'boolean' ? stored : fallback) as CompanySettings[K];
  if (typeof fallback === 'number') return (isPositiveInteger(stored) ? stored : fallback) as CompanySettings[K];
  if (typeof fallback === 'string') return (typeof stored === 'string' ? stored : fallback) as CompanySettings[K];
  if (typeof stored === 'number' || typeof stored === 'string') return stored as CompanySettings[K];
  return fallback;
}
