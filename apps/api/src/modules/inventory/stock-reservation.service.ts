import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { reservationShortfalls, type ReservationLine } from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../../common/cls';
import type { TenantTransaction } from '../../common/prisma/prisma.service';
import { SettingsService } from '../../common/settings/settings.service';

/** Adds the quantities of repeated products and sorts by product id, the order every lock below is taken in. */
function mergeSorted(lines: readonly ReservationLine[]): ReservationLine[] {
  const merged = new Map<string, number>();
  for (const line of lines) merged.set(line.productId, (merged.get(line.productId) ?? 0) + line.quantity);
  // the same comparison as the POS sale, so both lock products in one order
  return [...merged]
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));
}

/**
 * The only writer of `stock_levels.reserved` (HU-VEN-19). A reservation holds units of a warehouse for an order: the
 * available stock (`quantity − reserved`) drops, so a sale or another order cannot take them, but `quantity` and the kardex
 * do not change — no `StockMovement` is written until the units leave (the dispatch, HU-VEN-20).
 *
 * Locks follow the same order as a POS sale (`PosPaymentService.assertAvailable`): the product row, then its level, both
 * `FOR UPDATE` and by product id, so two reservations — or a reservation and a sale — never wait on each other in a loop.
 * Call inside the transaction of the business change: the reservation commits or rolls back with it.
 */
@Injectable()
export class StockReservationService {
  constructor(
    private readonly cls: ClsService<AppClsStore>,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Reserves every line or none: when any product is short it throws `409 INSUFFICIENT_STOCK` with all the short products.
   * With `inventory.allowNegativeStock` the availability is not checked, as at the POS.
   */
  async reserve(tx: TenantTransaction, warehouseId: string, lines: readonly ReservationLine[]): Promise<void> {
    const companyId = this.companyId();
    const sorted = mergeSorted(lines);
    if (sorted.some((line) => !Number.isInteger(line.quantity) || line.quantity < 1)) {
      throw new BadRequestException({ code: 'INVALID_QUANTITY', message: 'A reservation needs whole quantities of at least 1' });
    }
    // like a stock movement, a reservation waits for a deactivation of the warehouse and refuses an inactive one
    const [warehouse] = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM warehouses WHERE id = ${warehouseId}::uuid AND company_id = ${companyId}::uuid FOR SHARE`;
    if (!warehouse || warehouse.status !== 'ACTIVE') {
      throw new ConflictException({ code: 'SALES_WAREHOUSE_INACTIVE', message: 'The warehouse is inactive' });
    }
    const allowNegative = await this.settings.get('inventory.allowNegativeStock', tx);

    const levels = new Map<string, { quantity: number; reserved: number }>();
    for (const { productId } of sorted) {
      await this.lockProduct(tx, productId, companyId);
      // a product that never had stock has no level yet; the row is created empty so it can be locked and reserved
      await tx.$executeRaw`
        INSERT INTO stock_levels (id, company_id, product_id, warehouse_id, quantity, reserved, updated_at)
        VALUES (gen_random_uuid(), ${companyId}::uuid, ${productId}::uuid, ${warehouseId}::uuid, 0, 0, now())
        ON CONFLICT (product_id, warehouse_id) DO NOTHING`;
      const [level] = await tx.$queryRaw<{ quantity: number; reserved: number }[]>`
        SELECT quantity, reserved FROM stock_levels
        WHERE product_id = ${productId}::uuid AND warehouse_id = ${warehouseId}::uuid AND company_id = ${companyId}::uuid
        FOR UPDATE`;
      levels.set(productId, level);
    }

    const short = reservationShortfalls(sorted, levels, allowNegative);
    if (short.length > 0) {
      throw new ConflictException({
        code: 'INSUFFICIENT_STOCK',
        message: 'Not enough available stock to reserve the order',
        details: { items: short },
      });
    }

    for (const { productId, quantity } of sorted) {
      await tx.$executeRaw`
        UPDATE stock_levels SET reserved = reserved + ${quantity}, updated_at = now()
        WHERE product_id = ${productId}::uuid AND warehouse_id = ${warehouseId}::uuid AND company_id = ${companyId}::uuid`;
    }
  }

  /** Gives reserved units back. It never takes `reserved` below zero, so releasing twice cannot free another order's units. */
  async release(tx: TenantTransaction, warehouseId: string, lines: readonly ReservationLine[]): Promise<void> {
    const companyId = this.companyId();
    for (const { productId, quantity } of mergeSorted(lines)) {
      if (quantity <= 0) continue;
      await this.lockProduct(tx, productId, companyId);
      await tx.$executeRaw`
        UPDATE stock_levels SET reserved = GREATEST(reserved - ${quantity}, 0), updated_at = now()
        WHERE product_id = ${productId}::uuid AND warehouse_id = ${warehouseId}::uuid AND company_id = ${companyId}::uuid`;
    }
  }

  /**
   * A dispatch takes reserved units out: `reserved` drops by the dispatched quantity, and the caller writes the `SALE` movement
   * of the same units through `StockMovementService` in the same transaction, so the available stock (`quantity − reserved`)
   * does not move for anyone else. Refuses to take more than is reserved, so `reserved` never goes below zero.
   */
  async consume(tx: TenantTransaction, warehouseId: string, lines: readonly ReservationLine[]): Promise<void> {
    const companyId = this.companyId();
    for (const { productId, quantity } of mergeSorted(lines)) {
      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new BadRequestException({ code: 'INVALID_QUANTITY', message: 'A dispatch needs whole quantities of at least 1' });
      }
      await this.lockProduct(tx, productId, companyId);
      const updated = await tx.$executeRaw`
        UPDATE stock_levels SET reserved = reserved - ${quantity}, updated_at = now()
        WHERE product_id = ${productId}::uuid AND warehouse_id = ${warehouseId}::uuid AND company_id = ${companyId}::uuid
          AND reserved >= ${quantity}`;
      if (updated === 0) {
        throw new ConflictException({
          code: 'RESERVATION_SHORT',
          message: 'The warehouse holds fewer reserved units than the dispatch needs',
          details: { productId, requested: quantity },
        });
      }
    }
  }

  private async lockProduct(tx: TenantTransaction, productId: string, companyId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${productId}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;
  }

  private companyId(): string {
    const id = this.cls.get('companyId');
    if (!id) throw new Error('StockReservationService needs a company in the request context');
    return id;
  }
}
