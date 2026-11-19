import type { Prisma } from '@prisma/client';
import { INVOICE_LEGEND_DEFAULT } from '@rodasoft/domain';

type Tx = Prisma.TransactionClient;

/** What a product carries for the SIN (HU-FAC-26). */
export interface ProductSinCodes {
  sinProductCode: string | null;
  sinActivityCode: string | null;
  sinUnitCode: number | null;
}

export interface SinLine {
  sinProductCode: string | null;
  sinActivityCode: string | null;
  sinUnitCode: number | null;
}

/** The company-level fiscal data a document is built with: the main activity, the code for a product without one, the legend. */
export interface CompanyFiscalData {
  mainActivityCode: string | null;
  defaultProductCode: string | null;
  defaultProductActivity: string | null;
}

export async function readFiscalData(tx: Tx, companyId: string): Promise<CompanyFiscalData> {
  const settings = await tx.siatSettings.findUnique({ where: { companyId }, select: { mainActivityCode: true, defaultProductCode: true } });
  const defaultProduct = settings?.defaultProductCode
    ? await tx.siatCatalogEntry.findFirst({ where: { companyId, catalog: 'PRODUCT_SERVICE', code: settings.defaultProductCode }, select: { activityCode: true } })
    : null;
  return {
    mainActivityCode: settings?.mainActivityCode ?? null,
    defaultProductCode: settings?.defaultProductCode ?? null,
    defaultProductActivity: defaultProduct?.activityCode || null,
  };
}

/**
 * The legend printed on an invoice: the first active legend of the synced catalogue for the main activity, or the built-in one
 * while the company has not synced (or chosen an activity). Chosen once, at the first send (HU-FAC-25): the caller keeps it.
 */
export async function chooseLegend(tx: Tx, companyId: string, activityCode: string | null): Promise<string> {
  if (!activityCode) return INVOICE_LEGEND_DEFAULT;
  const legend = await tx.siatCatalogEntry.findFirst({
    where: { companyId, catalog: 'LEGEND', activityCode, active: true },
    orderBy: { code: 'asc' },
    select: { description: true },
  });
  return legend?.description ?? INVOICE_LEGEND_DEFAULT;
}

/** The SIN codes of one line: the product's own, or the company default code (and main activity) when homologation is not required. */
export function sinLineOf(product: ProductSinCodes, data: CompanyFiscalData): SinLine {
  if (product.sinProductCode) return { sinProductCode: product.sinProductCode, sinActivityCode: product.sinActivityCode ?? data.mainActivityCode, sinUnitCode: product.sinUnitCode };
  return { sinProductCode: data.defaultProductCode, sinActivityCode: data.defaultProductActivity ?? data.mainActivityCode, sinUnitCode: product.sinUnitCode };
}

/** Whether a product with no SIN code of its own stops the document (`invoicing.requireHomologation` on). */
export function lacksHomologation(products: readonly ProductSinCodes[]): boolean {
  return products.some((product) => !product.sinProductCode);
}
