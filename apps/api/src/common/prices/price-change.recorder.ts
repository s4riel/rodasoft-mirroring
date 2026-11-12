import { Decimal, type PriceChangeSource } from '@rodasoft/domain';
import type { TenantTransaction } from '../prisma/prisma.service';

export interface PriceChangeRecord {
  companyId: string;
  productId: string;
  /** Decimal strings with two decimals. */
  oldPrice: string;
  newPrice: string;
  userId: string;
  source: PriceChangeSource;
  reason?: string | null;
  /** Groups the rows of one bulk update (HU-VEN-27). */
  batchId?: string | null;
}

/**
 * Writes the `price_changes` row of a price that moved, inside the transaction that updates `products.sale_price`. Every path
 * that changes a price calls it (the Precios screen, the inventory product form, the Excel import), so the history has no holes.
 * Returns null, and writes nothing, when the price did not change.
 */
export async function recordPriceChange(tx: TenantTransaction, change: PriceChangeRecord): Promise<{ id: string } | null> {
  if (Decimal.of(change.oldPrice).eq(Decimal.of(change.newPrice))) return null;
  return tx.priceChange.create({
    data: {
      companyId: change.companyId,
      productId: change.productId,
      oldPrice: change.oldPrice,
      newPrice: change.newPrice,
      userId: change.userId,
      source: change.source,
      reason: change.reason ?? null,
      batchId: change.batchId ?? null,
    },
    select: { id: true },
  });
}
