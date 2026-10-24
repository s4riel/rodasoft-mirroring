/** Rules of the product creation wizard (HU-INV-06): steps, required fields and validation of the draft. */
import { Decimal } from './money';
import type { AttributeKind } from './product-catalog';

export type WizardStepKey = 'identification' | 'dimensions' | 'specifications' | 'price-inventory' | 'photos' | 'equivalences';

export interface WizardStep {
  key: WizardStepKey;
  required: boolean;
}

/** Bearings have 6 steps (with dimensions and equivalences); the other categories have 4 (design-notes). */
export function wizardSteps(isBearing: boolean): WizardStep[] {
  if (isBearing) {
    return [
      { key: 'identification', required: true },
      { key: 'dimensions', required: true },
      { key: 'specifications', required: false },
      { key: 'price-inventory', required: true },
      { key: 'photos', required: false },
      { key: 'equivalences', required: false },
    ];
  }
  // IN-03c: specifications are required for the other categories too
  return [
    { key: 'identification', required: true },
    { key: 'specifications', required: true },
    { key: 'price-inventory', required: true },
    { key: 'photos', required: false },
  ];
}

/** Progress counter of the wizard: only the required steps count ("2 de 3 requeridos"). */
export function completedRequiredSteps(
  steps: readonly WizardStep[],
  completed: ReadonlySet<WizardStepKey>,
): { done: number; total: number } {
  const required = steps.filter((s) => s.required);
  return { done: required.filter((s) => completed.has(s.key)).length, total: required.length };
}

export const PRODUCT_DRAFT_ERROR_CODES = [
  'CODE_REQUIRED',
  'BRAND_REQUIRED',
  'CATEGORY_REQUIRED',
  'DIMENSIONS_REQUIRED',
  'PRICE_REQUIRED',
  'ATTRIBUTE_REQUIRED',
  'ATTRIBUTE_TYPE',
  'ATTRIBUTE_OPTION',
  'ATTRIBUTE_UNKNOWN',
  'PRICE_FORMAT',
  'COST_FORMAT',
  'MEASURE_FORMAT',
  'DIAMETER_ORDER',
  'TARIFF_FORMAT',
  'DATE_INVALID',
  'DATE_FUTURE',
  'STOCK_RANGE',
] as const;

export type ProductDraftErrorCode = (typeof PRODUCT_DRAFT_ERROR_CODES)[number];

export interface ProductFieldError {
  field: string;
  code: ProductDraftErrorCode;
}

/** A technical field of the category, as the wizard asks for it (`attribute_definitions`). */
export interface AttributeRule {
  key: string;
  type: AttributeKind;
  required: boolean;
  options: readonly string[] | null;
}

export interface ProductDraftInput {
  manufacturerCode: string | null;
  brandId: string | null;
  categoryId: string | null;
  isBearing: boolean;
  salePrice: string | null;
  dimensions: { innerDiameter: string | null; outerDiameter: string | null; width: string | null };
  attributes: Readonly<Record<string, unknown>>;
  /** The fields below are checked for format only when present; amounts and measures accept a comma or a dot. */
  cost?: string | null;
  weight?: string | null;
  tariffCode?: string | null;
  /** `YYYY-MM-DD`. */
  entryDate?: string | null;
  minStock?: number | null;
  maxStock?: number | null;
  /** Today in the business timezone (`YYYY-MM-DD`); when given, an entry date after it is refused. */
  today?: string;
}

/** Amounts: up to 11 digits and 2 decimals for the price, 4 for the cost; measures: 7 digits and 3 decimals. */
const PRICE_RE = /^\d{1,11}([.,]\d{1,2})?$/;
const COST_RE = /^\d{1,10}([.,]\d{1,4})?$/;
const MEASURE_RE = /^\d{1,7}([.,]\d{1,3})?$/;
/** Tariff heading as printed on customs papers: "8482", "8482.10", "8482.10.00.00" (dots optional). */
const TARIFF_RE = /^\d{4}(\.?\d{2}){0,3}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Today as `YYYY-MM-DD` in the business timezone (America/La_Paz). */
export function todayInLaPaz(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(now);
}

const isBlank = (value: string | null | undefined): boolean => value === null || value === undefined || value.trim() === '';

function isRealDate(text: string): boolean {
  const match = DATE_RE.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Format of the values that are present (blank ones are not checked here: `validateProductDraft` decides which are
 * required). The field of each error is the field of the form, so the wizard can mark it.
 */
export function validateFieldFormats(input: ProductDraftInput): ProductFieldError[] {
  const errors: ProductFieldError[] = [];
  const price = input.salePrice?.trim();
  if (price && !PRICE_RE.test(price)) errors.push({ field: 'salePrice', code: 'PRICE_FORMAT' });
  const cost = input.cost?.trim();
  if (cost && !COST_RE.test(cost)) errors.push({ field: 'cost', code: 'COST_FORMAT' });

  const measures = { ...input.dimensions, weight: input.weight ?? null };
  for (const [field, raw] of Object.entries(measures)) {
    const value = raw?.trim();
    if (value && (!MEASURE_RE.test(value) || Number(value.replace(',', '.')) <= 0)) errors.push({ field, code: 'MEASURE_FORMAT' });
  }
  const { innerDiameter, outerDiameter } = input.dimensions;
  if (!errors.some((e) => e.field === 'innerDiameter' || e.field === 'outerDiameter') && !isBlank(innerDiameter) && !isBlank(outerDiameter)) {
    // the bore is always smaller than the outside of the bearing
    if (Number((innerDiameter ?? '').replace(',', '.')) >= Number((outerDiameter ?? '').replace(',', '.'))) {
      errors.push({ field: 'outerDiameter', code: 'DIAMETER_ORDER' });
    }
  }

  const tariff = input.tariffCode?.trim();
  if (tariff && !TARIFF_RE.test(tariff)) errors.push({ field: 'tariffCode', code: 'TARIFF_FORMAT' });
  const entry = input.entryDate?.trim();
  if (entry) {
    if (!isRealDate(entry)) errors.push({ field: 'entryDate', code: 'DATE_INVALID' });
    else if (input.today && entry > input.today) errors.push({ field: 'entryDate', code: 'DATE_FUTURE' });
  }
  if (typeof input.minStock === 'number' && typeof input.maxStock === 'number' && input.maxStock < input.minStock) {
    errors.push({ field: 'maxStock', code: 'STOCK_RANGE' });
  }
  return errors;
}

/**
 * Checks a product against the wizard rules. A draft only needs the code and the brand; a final product needs
 * everything the category requires. Values that are present are type-checked in both cases.
 */
export function validateProductDraft(
  input: ProductDraftInput,
  definitions: readonly AttributeRule[],
  { draft }: { draft: boolean },
): ProductFieldError[] {
  const errors: ProductFieldError[] = [];

  if (!input.manufacturerCode?.trim()) errors.push({ field: 'manufacturerCode', code: 'CODE_REQUIRED' });
  if (!input.brandId) errors.push({ field: 'brandId', code: 'BRAND_REQUIRED' });
  // the format of what is present is checked in drafts too: a draft keeps what the user typed, so it cannot keep garbage
  const formats = validateFieldFormats(input);
  if (draft) return [...errors, ...formats, ...attributeErrors(input.attributes, definitions, draft)];

  if (!input.categoryId) errors.push({ field: 'categoryId', code: 'CATEGORY_REQUIRED' });
  if (input.isBearing && !isComplete(input.dimensions)) {
    errors.push({ field: 'dimensions', code: 'DIMENSIONS_REQUIRED' });
  }
  // a price with a wrong format already has its own error: it is not "missing"
  if (!formats.some((e) => e.field === 'salePrice') && !isPositiveMoney(input.salePrice)) {
    errors.push({ field: 'salePrice', code: 'PRICE_REQUIRED' });
  }
  return [...errors, ...formats, ...attributeErrors(input.attributes, definitions, draft)];
}

function isComplete(d: ProductDraftInput['dimensions']): boolean {
  return [d.innerDiameter, d.outerDiameter, d.width].every((v) => v !== null && v.trim() !== '');
}

function isPositiveMoney(value: string | null): boolean {
  if (value === null || value.trim() === '') return false;
  try {
    return Decimal.of(value.trim()).cmp(Decimal.zero()) > 0;
  } catch {
    return false;
  }
}

function attributeErrors(
  attributes: Readonly<Record<string, unknown>>,
  definitions: readonly AttributeRule[],
  draft: boolean,
): ProductFieldError[] {
  const errors: ProductFieldError[] = [];
  // a key the category does not define would be stored but never shown or checked
  const known = new Set(definitions.map((d) => d.key));
  for (const key of Object.keys(attributes)) {
    if (!known.has(key)) errors.push({ field: key, code: 'ATTRIBUTE_UNKNOWN' });
  }
  for (const def of definitions) {
    const value = attributes[def.key];
    const empty = value === undefined || value === null || value === '';
    if (empty) {
      if (def.required && !draft) errors.push({ field: def.key, code: 'ATTRIBUTE_REQUIRED' });
      continue;
    }
    if (!matchesType(value, def.type)) {
      errors.push({ field: def.key, code: 'ATTRIBUTE_TYPE' });
    } else if (def.type === 'ENUM' && !(def.options ?? []).includes(String(value))) {
      errors.push({ field: def.key, code: 'ATTRIBUTE_OPTION' });
    }
  }
  return errors;
}

function matchesType(value: unknown, type: AttributeKind): boolean {
  switch (type) {
    case 'TEXT':
    case 'ENUM':
      return typeof value === 'string';
    case 'BOOLEAN':
      return typeof value === 'boolean';
    case 'NUMBER':
      return typeof value === 'number' ? Number.isFinite(value) : typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value);
  }
}

/** One technical field of a category, as the wizard asks for it. */
export interface AttributeDefinitionItem {
  key: string;
  label: string;
  type: AttributeKind;
  unit: string | null;
  options: string[] | null;
  required: boolean;
  step: number;
  sortOrder: number;
}

/** `GET /inventory/categories/:id/attribute-definitions`. `definedOn` is the category that owns the fields (its parent's when it has none). */
export interface CategoryAttributeDefinitionsResponse {
  categoryId: string;
  definedOn: string;
  items: AttributeDefinitionItem[];
}

/** Body of `POST /inventory/products` and `PATCH /inventory/products/:id/draft` (the API's `ProductWriteDto`). */
export interface ProductWriteRequest {
  status?: 'ACTIVE' | 'DRAFT';
  manufacturerCode?: string;
  brandId?: string;
  categoryId?: string;
  countryId?: string | null;
  name?: string | null;
  salePrice?: string | null;
  cost?: string | null;
  unit?: string;
  innerDiameter?: string | null;
  outerDiameter?: string | null;
  width?: string | null;
  weight?: string | null;
  attributes?: Record<string, unknown>;
  sectors?: string[];
  photos?: string[];
  /** Storage key of the datasheet; null removes it. */
  datasheetKey?: string | null;
  tariffCode?: string | null;
  supplierName?: string | null;
  entryDate?: string | null;
  branchId?: string;
  initialStock?: number;
  minStock?: number;
  maxStock?: number;
  location?: string | null;
}

export interface ProductWriteResponse {
  id: string;
  sku: string;
  status: 'ACTIVE' | 'DRAFT';
}

/** `GET /inventory/products/code-availability`: `productId` is the product that already uses the code, when taken. */
export interface CodeAvailabilityResponse {
  available: boolean;
  productId: string | null;
}
