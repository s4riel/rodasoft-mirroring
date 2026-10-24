import { todayInLaPaz } from '@rodasoft/domain';
import type {
  AttributeDefinitionItem,
  AttributeRule,
  ProductDraftErrorCode,
  ProductDraftInput,
  ProductUpdateRequest,
  ProductWriteRequest,
  WizardStepKey,
} from '@rodasoft/domain';

/** Root category whose products are bearings: they get the dimensions step and the equivalences step. */
export const BEARING_CATEGORY_NAME = 'Rodamientos';

/** Field error the wizard shows: the domain codes, plus the duplicate code found by the live check or by the API. */
export interface WizardFieldError {
  field: string;
  code: ProductDraftErrorCode | 'DUPLICATE_MANUFACTURER_CODE' | 'STOCK_INVALID';
}

/** Visible labels of the wizard steps (IN-03 Stepper). `required` comes from `wizardSteps`. */
/** Sectors offered as chips on step 1 (IN-03c sample list; the API stores any text up to 60 characters). */
export const WIZARD_SECTORS = ['Minería', 'Transporte', 'Industria', 'Agrícola', 'Automotriz'] as const;

export const WIZARD_STEP_LABELS: Record<WizardStepKey, string> = {
  identification: 'Identificación',
  dimensions: 'Dimensiones',
  specifications: 'Especificaciones',
  'price-inventory': 'Precio e inventario',
  photos: 'Fotos y ficha',
  equivalences: 'Equivalencias',
};

/** Values of the wizard form as the screens hold them (strings for every input; empty string = not filled). */
export interface WizardFormValues {
  manufacturerCode: string;
  name: string;
  sectors: readonly string[];
  brandId: string | null;
  countryId: string | null;
  subcategoryId: string | null;
  innerDiameter: string;
  outerDiameter: string;
  width: string;
  weight: string;
  salePrice: string;
  cost: string;
  unit: string;
  branchId: string | null;
  initialStock: string;
  minStock: string;
  maxStock: string;
  location: string;
  supplierName: string;
  tariffCode: string;
  entryDate: string;
  attributes: Readonly<Record<string, string>>;
}

const MB = 1024 * 1024;
/** Size limits of the files (the API is the authority; this only saves a round trip). */
const UPLOAD_LIMITS = { photo: { bytes: 5 * MB, label: '5 MB', types: ['image/jpeg', 'image/png', 'image/webp'] }, datasheet: { bytes: 10 * MB, label: '10 MB', types: ['application/pdf'] } } as const;

/** "3,5 MB" / "820 KB": sizes are written with a comma in Bolivia. */
export function formatSize(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Second line of a file that is uploading: its size and the time left, estimated from the speed so far. */
export function uploadDetailOf(totalBytes: number, percent: number, elapsedMs: number): string {
  const size = formatSize(totalBytes);
  if (percent >= 100) return `${size} · Procesando…`;
  if (percent < 5 || elapsedMs < 500) return size;
  const seconds = Math.ceil((elapsedMs / 1000) * ((100 - percent) / percent));
  return `${size} · ${seconds >= 60 ? `${Math.ceil(seconds / 60)} min` : `${seconds} s`} restantes`;
}

/** Why a file cannot be uploaded as this kind, or null when it can. */
export function uploadProblemOf(kind: 'photo' | 'datasheet', file: { name: string; type: string; size: number }): string | null {
  const limit = UPLOAD_LIMITS[kind];
  if (!(limit.types as readonly string[]).includes(file.type)) {
    return kind === 'photo' ? `${file.name}: usa una imagen JPG, PNG o WEBP.` : `${file.name}: la ficha técnica debe ser un PDF.`;
  }
  if (file.size > limit.bytes) return `${file.name}: pesa más de ${limit.label}.`;
  return null;
}

/** Suggested commercial name: category, brand and code, as the API builds it when the name is left empty. */
export function commercialNameOf(category: string | null, brand: string | null, code: string): string {
  return [category, brand, code.trim()].filter((part) => !!part).join(' ');
}

/** Attributes shown on the dimensions step (bearings only) and on the specifications step (the rest). */
export function attributeStep(definition: AttributeDefinitionItem, isBearing: boolean): WizardStepKey {
  return isBearing && definition.step === 2 ? 'dimensions' : 'specifications';
}

/** Free-text fields that hold sentences (technical notes): shown as a wide text area that grows with the text. */
export function isLongText(definition: AttributeDefinitionItem): boolean {
  return definition.type === 'TEXT' && /notes|observ/i.test(`${definition.key} ${definition.label}`);
}

/** Placeholder of a technical field, from its type and label: it says what to write, never a made-up value. */
export function placeholderOf(definition: AttributeDefinitionItem): string {
  const label = definition.label.toLowerCase();
  if (isLongText(definition)) return `Escribe ${label} del producto`;
  if (definition.type === 'NUMBER') return definition.unit ? `0,00 ${definition.unit}` : '0';
  if (definition.type === 'ENUM') return 'Selecciona una opción';
  return `Ingresa ${label}`;
}

export function attributeRules(definitions: readonly AttributeDefinitionItem[]): AttributeRule[] {
  return definitions.map((d) => ({ key: d.key, type: d.type, required: d.required, options: d.options }));
}

/** Form text to the typed value stored in `products.attributes`; an empty text is no value. */
export function attributeValue(definition: AttributeDefinitionItem, text: string): string | number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return definition.type === 'NUMBER' ? Number(trimmed.replace(',', '.')) : trimmed;
}

/** Only the wizard fields that the chosen category has, with their typed values. */
export function attributesPayload(
  definitions: readonly AttributeDefinitionItem[],
  values: Readonly<Record<string, string>>,
): Record<string, string | number | null> {
  const payload: Record<string, string | number | null> = {};
  for (const definition of definitions) {
    const value = attributeValue(definition, values[definition.key] ?? '');
    // an empty field is sent as null so a saved draft clears it instead of keeping the stored value
    payload[definition.key] = value ?? null;
  }
  return payload;
}

/** The product checked by `validateProductDraft` (the same rules the API applies). */
export function draftInputOf(values: WizardFormValues, categoryId: string | null, isBearing: boolean): ProductDraftInput {
  return {
    manufacturerCode: values.manufacturerCode.trim() || null,
    brandId: values.brandId,
    categoryId: values.subcategoryId ?? categoryId,
    isBearing,
    salePrice: values.salePrice.trim() || null,
    dimensions: {
      innerDiameter: values.innerDiameter.trim() || null,
      outerDiameter: values.outerDiameter.trim() || null,
      width: values.width.trim() || null,
    },
    attributes: values.attributes,
    cost: values.cost.trim() || null,
    weight: values.weight.trim() || null,
    tariffCode: values.tariffCode.trim() || null,
    entryDate: values.entryDate.trim() || null,
    minStock: stockOf(values.minStock) ?? null,
    maxStock: stockOf(values.maxStock) ?? null,
    today: todayInLaPaz(),
  };
}

/** Whole numbers only (the API takes integers); a text that is not one is reported by `invalidStockFields`. */
function stockOf(text: string): number | undefined {
  const trimmed = text.trim();
  return trimmed && STOCK_RE.test(trimmed) ? Number(trimmed) : undefined;
}

const STOCK_RE = /^\d+$/;

/** Stock fields whose text is not a whole number; the wizard blocks the step until they are fixed. */
export function invalidStockFields(values: WizardFormValues): string[] {
  return (['initialStock', 'minStock', 'maxStock'] as const).filter((key) => {
    const trimmed = values[key].trim();
    return trimmed !== "" && !STOCK_RE.test(trimmed);
  });
}

/** Money and measures are typed with a comma in Bolivia ("245,00"); the API takes a dot. */
function decimalOf(text: string): string | undefined {
  const trimmed = text.trim().replace(",", ".");
  return trimmed || undefined;
}

function textOf(text: string): string | undefined {
  const trimmed = text.trim();
  return trimmed || undefined;
}

/**
 * Body of `POST /inventory/products` (status ACTIVE) and of the draft requests. Cost is only sent when the role can
 * see costs; the API ignores it otherwise.
 */
export function toWriteRequest(
  values: WizardFormValues,
  definitions: readonly AttributeDefinitionItem[],
  { status, categoryId, withCost }: { status: 'ACTIVE' | 'DRAFT'; categoryId: string | null; withCost: boolean },
): ProductWriteRequest {
  const body: ProductWriteRequest = {
    status,
    manufacturerCode: textOf(values.manufacturerCode),
    brandId: values.brandId ?? undefined,
    categoryId: values.subcategoryId ?? categoryId ?? undefined,
    countryId: values.countryId ?? null,
    name: textOf(values.name) ?? null,
    sectors: [...values.sectors],
    salePrice: decimalOf(values.salePrice) ?? null,
    unit: textOf(values.unit),
    innerDiameter: decimalOf(values.innerDiameter) ?? null,
    outerDiameter: decimalOf(values.outerDiameter) ?? null,
    width: decimalOf(values.width) ?? null,
    weight: decimalOf(values.weight) ?? null,
    attributes: attributesPayload(definitions, values.attributes),
    tariffCode: textOf(values.tariffCode) ?? null,
    supplierName: textOf(values.supplierName) ?? null,
    entryDate: textOf(values.entryDate) ?? null,
    location: textOf(values.location) ?? null,
    branchId: values.branchId ?? undefined,
    initialStock: stockOf(values.initialStock),
    minStock: stockOf(values.minStock),
    maxStock: stockOf(values.maxStock),
  };
  if (withCost) body.cost = decimalOf(values.cost) ?? null;
  return body;
}

/**
 * Body of `PATCH /inventory/products/:id` (HU-INV-07): the whole form without stock, receiving branch or status. The
 * thresholds only travel when the user touched them, for the branch whose main warehouse holds them; an emptied one is
 * sent as null so it is cleared.
 */
export function toUpdateRequest(
  values: WizardFormValues,
  definitions: readonly AttributeDefinitionItem[],
  {
    categoryId,
    withCost,
    expectedUpdatedAt,
    thresholdBranchId,
  }: { categoryId: string | null; withCost: boolean; expectedUpdatedAt: string; thresholdBranchId: string | null },
): ProductUpdateRequest {
  const request = toWriteRequest(values, definitions, { status: 'ACTIVE', categoryId, withCost });
  delete request.status;
  delete request.branchId;
  delete request.initialStock;
  delete request.minStock;
  delete request.maxStock;
  delete request.location;
  const update: ProductUpdateRequest = { ...request, expectedUpdatedAt };
  if (thresholdBranchId) {
    update.thresholdBranchId = thresholdBranchId;
    update.minStock = stockOf(values.minStock) ?? null;
    update.maxStock = stockOf(values.maxStock) ?? null;
    update.location = textOf(values.location) ?? null;
  }
  return update;
}

/** Visible text of a field error code (Spanish, IN-03 error states). */
export const FIELD_ERROR_MESSAGES: Record<string, string> = {
  CODE_REQUIRED: 'Ingresa el código del fabricante.',
  STOCK_INVALID: 'Usa solo números enteros, sin unidades.',
  DUPLICATE_MANUFACTURER_CODE: 'Ya existe un producto con este código para la marca.',
  BRAND_REQUIRED: 'Selecciona una marca.',
  CATEGORY_REQUIRED: 'Selecciona una categoría.',
  DIMENSIONS_REQUIRED: 'Completa d, D y B para ubicar el rodamiento.',
  PRICE_REQUIRED: 'Falta el precio de venta.',
  ATTRIBUTE_REQUIRED: 'Este campo es obligatorio.',
  ATTRIBUTE_TYPE: 'El valor no tiene el formato correcto.',
  ATTRIBUTE_OPTION: 'Elige una de las opciones.',
  ATTRIBUTE_UNKNOWN: 'Este campo no existe en la categoría.',
  PRICE_FORMAT: 'Usa un monto válido, como 245,50 (hasta 2 decimales).',
  COST_FORMAT: 'Usa un monto válido, como 120,50 (hasta 4 decimales).',
  MEASURE_FORMAT: 'Usa un número mayor a 0, con hasta 3 decimales.',
  DIAMETER_ORDER: 'D debe ser mayor que d.',
  TARIFF_FORMAT: 'Usa la partida como 8482.10 o 8482.10.00.00.',
  DATE_INVALID: 'La fecha no es válida.',
  DATE_FUTURE: 'La fecha de ingreso no puede ser futura.',
  STOCK_RANGE: 'El máximo no puede ser menor que el mínimo.',
};
