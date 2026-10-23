import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { StockMovementType } from '@prisma/client';
import { applyMovement, InsufficientStockError } from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../../common/cls';
import type { TenantTransaction } from '../../common/prisma/prisma.service';
import { SettingsService } from '../../common/settings/settings.service';

export interface StockMovementInput {
  productId: string;
  warehouseId: string;
  type: StockMovementType;
  /** Signed: positive adds stock, negative removes it. */
  quantity: number;
  reason: string;
  refType?: string | null;
  refId?: string | null;
  refNumber?: string | null;
  unitCost?: string | null;
}

/**
 * The only writer of `stock_levels` and `stock_movements` (design-notes rule 1). The level row is locked with
 * `SELECT ... FOR UPDATE`, so concurrent movements on the same product and warehouse run one after the other.
 * Call `apply` inside the transaction of the business change: the level and the movement commit or roll back together.
 */
@Injectable()
export class StockMovementService {
  constructor(
    private readonly cls: ClsService<AppClsStore>,
    private readonly settings: SettingsService,
  ) {}

  async apply(tx: TenantTransaction, input: StockMovementInput): Promise<{ balanceAfter: number }> {
    const companyId = this.cls.get('companyId');
    if (!companyId) throw new Error('Stock movement outside a company context');

    // the product row lock serializes movements with remove(), which takes the same lock before checking for stock
    const [product] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM products WHERE id = ${input.productId}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;
    if (!product) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });
    const [warehouse] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM warehouses WHERE id = ${input.warehouseId}::uuid AND company_id = ${companyId}::uuid`;
    if (!warehouse) throw new NotFoundException({ code: 'WAREHOUSE_NOT_FOUND', message: 'Warehouse not found' });

    // the level is created on first use; ON CONFLICT keeps a concurrent creator's row
    await tx.$executeRaw`
      INSERT INTO stock_levels (id, company_id, product_id, warehouse_id, quantity, reserved, updated_at)
      VALUES (gen_random_uuid(), ${companyId}::uuid, ${input.productId}::uuid, ${input.warehouseId}::uuid, 0, 0, now())
      ON CONFLICT (product_id, warehouse_id) DO NOTHING`;

    const [level] = await tx.$queryRaw<{ quantity: number }[]>`
      SELECT quantity FROM stock_levels
      WHERE product_id = ${input.productId}::uuid AND warehouse_id = ${input.warehouseId}::uuid AND company_id = ${companyId}::uuid
      FOR UPDATE`;
    const allowNegative = await this.settings.get('inventory.allowNegativeStock', tx);

    let balanceAfter: number;
    try {
      ({ balanceAfter } = applyMovement(level.quantity, input.quantity, allowNegative));
    } catch (err) {
      if (err instanceof InsufficientStockError) {
        throw new UnprocessableEntityException({ code: 'INSUFFICIENT_STOCK', message: 'Not enough stock in the warehouse' });
      }
      throw err;
    }

    await tx.stockLevel.updateMany({
      where: { productId: input.productId, warehouseId: input.warehouseId },
      data: { quantity: balanceAfter },
    });
    await tx.stockMovement.create({
      data: {
        companyId,
        productId: input.productId,
        warehouseId: input.warehouseId,
        type: input.type,
        quantity: input.quantity,
        balanceAfter,
        unitCost: input.unitCost ?? null,
        reason: input.reason,
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        refNumber: input.refNumber ?? null,
        userId: this.cls.get('userId') ?? null,
      },
    });
    return { balanceAfter };
  }
}
