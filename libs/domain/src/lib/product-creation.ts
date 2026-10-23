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
  return [
    { key: 'identification', required: true },
    { key: 'specifications', required: false },
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
  if (draft) return [...errors, ...attributeErrors(input.attributes, definitions, draft)];

  if (!input.categoryId) errors.push({ field: 'categoryId', code: 'CATEGORY_REQUIRED' });
  if (input.isBearing && !isComplete(input.dimensions)) {
    errors.push({ field: 'dimensions', code: 'DIMENSIONS_REQUIRED' });
  }
  if (!isPositiveMoney(input.salePrice)) errors.push({ field: 'salePrice', code: 'PRICE_REQUIRED' });
  return [...errors, ...attributeErrors(input.attributes, definitions, draft)];
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
  countryId?: string;
  name?: string;
  salePrice?: string;
  cost?: string;
  unit?: string;
  innerDiameter?: string;
  outerDiameter?: string;
  width?: string;
  weight?: string;
  attributes?: Record<string, unknown>;
  sectors?: string[];
  tariffCode?: string;
  supplierName?: string;
  entryDate?: string;
  branchId?: string;
  initialStock?: number;
  minStock?: number;
  maxStock?: number;
  location?: string;
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
