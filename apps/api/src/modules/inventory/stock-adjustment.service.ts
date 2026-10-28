import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  AdjustmentError,
  type AdjustmentKind,
  ADJUSTMENT_REF_TYPE,
  buildAdjustmentMovement,
  formatAdjustmentNumber,
  needsApproval,
  parseAdjustmentNumber,
  type MovementDirection,
  type QuickAdjustmentResponse,
  resolveAdjustment,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../common/audit/audit.service';
import type { AppClsStore } from '../../common/cls';
import { OutboxService } from '../../common/outbox/outbox.service';
import { PrismaService, type TenantTransaction } from '../../common/prisma/prisma.service';
import { SettingsService } from '../../common/settings/settings.service';
import type { QuickAdjustmentDto } from './stock-adjustment.dto';
import { StockMovementService } from './stock-movement.service';

/**
 * Quick stock adjustment from the product sheet (HU-INV-16): one movement, no document. Stock is written only through
 * `StockMovementService`; this service decides the movement, numbers it (`AJ-000123`, the series HU-INV-22 will share),
 * checks the approval limit (decision #37) and records the audit entry and the outbox event in the same transaction.
 */
@Injectable()
export class StockAdjustmentService {
  private readonly logger = new Logger(StockAdjustmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly stock: StockMovementService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async quickAdjust(productId: string, dto: QuickAdjustmentDto): Promise<QuickAdjustmentResponse> {
    const companyId = this.cls.get('companyId');
    if (!companyId) throw new Error('Stock adjustment outside a company context');
    const userId = this.cls.get('userId') ?? null;

    // the reason and the quantity are checked before a transaction opens; a count's real movement needs the balance, so
    // this draft only validates (the movement is built again under the lock)
    this.buildMovement(dto.kind === 'COUNT' ? 'IN' : dto.kind, 1, dto);
    if (dto.kind !== 'COUNT' && dto.quantity < 1) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The quantity must be at least 1' });
    }

    return this.prisma.tenant.$transaction(async (tx) => {
      const product = await tx.product.findFirst({ where: { id: productId, companyId }, select: { sku: true } });
      if (!product) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });
      await this.assertWarehouseOperable(tx, dto.warehouseId);

      // numbering lock first, then the product and level locks (the order apply() uses), so concurrent adjustments cannot deadlock
      const refNumber = await this.nextNumber(tx, companyId);
      const { quantity: balanceBefore } = await this.stock.lockedQuantity(tx, productId, dto.warehouseId);
      if (dto.expectedBalance !== undefined && dto.expectedBalance !== balanceBefore) {
        throw new ConflictException({
          code: 'STOCK_CHANGED',
          message: 'The stock changed since it was read',
          details: { currentBalance: balanceBefore },
        });
      }

      const { direction, quantity } = this.resolve(dto.kind, dto.quantity, balanceBefore);
      const movement = this.buildMovement(direction, quantity, dto);

      // cost and limit are read under the product lock, so the value checked is the value stored on the movement
      const { cost } = await tx.product.findFirstOrThrow({ where: { id: productId, companyId }, select: { cost: true } });
      const unitCost = cost?.toString() ?? null;
      const threshold = await this.settings.get('adjustments.approvalThresholdValue', tx);
      if (threshold !== null && unitCost === null) {
        this.logger.warn(`Approval limit skipped for ${product.sku}: the product has no cost to value the adjustment`);
      }
      if (needsApproval(quantity, unitCost, threshold)) {
        throw new UnprocessableEntityException({
          code: 'ADJUSTMENT_NEEDS_APPROVAL',
          message: 'The adjustment is above the approval limit',
        });
      }

      const { movementId, balanceAfter } = await this.stock.apply(tx, {
        productId,
        warehouseId: dto.warehouseId,
        type: movement.type,
        quantity: movement.signedQuantity,
        reason: movement.reasonText,
        refType: ADJUSTMENT_REF_TYPE,
        refId: null,
        refNumber,
        unitCost,
      });

      await this.audit.log(
        {
          action: 'inventory.stock.adjust',
          entity: 'StockMovement',
          entityId: movementId,
          before: { balance: balanceBefore },
          after: {
            productId,
            warehouseId: dto.warehouseId,
            kind: dto.kind,
            type: movement.type,
            quantity: movement.signedQuantity,
            balance: balanceAfter,
            reason: movement.reasonText,
            refNumber,
          },
        },
        tx as unknown as Prisma.TransactionClient,
      );
      await this.outbox.publish(
        'inventory.stock.changed',
        { productId, warehouseId: dto.warehouseId, movementId, type: movement.type, quantity: movement.signedQuantity, balanceAfter, userId },
        { tx, companyId, idempotencyKey: `inventory.stock.changed:${movementId}` },
      );

      const totals = await tx.stockLevel.aggregate({ where: { productId, companyId }, _sum: { quantity: true } });
      return { movementId, refNumber, balanceAfter, totalStock: totals._sum.quantity ?? 0 };
    });
  }

  private buildMovement(direction: MovementDirection, quantity: number, dto: QuickAdjustmentDto) {
    try {
      return buildAdjustmentMovement({ direction, quantity, reason: dto.reason, note: dto.note });
    } catch (err) {
      if (err instanceof AdjustmentError) throw new BadRequestException({ code: err.code, message: err.message });
      throw err;
    }
  }

  /** The movement a kind and quantity mean against the locked balance; a count equal to the balance changes nothing. */
  private resolve(kind: AdjustmentKind, quantity: number, balance: number) {
    try {
      return resolveAdjustment({ kind, quantity, balance });
    } catch (err) {
      if (err instanceof AdjustmentError) throw new UnprocessableEntityException({ code: err.code, message: err.message });
      if (err instanceof RangeError) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: err.message });
      throw err;
    }
  }

  /** The warehouse must belong to a branch the member may operate; otherwise it does not exist for them. */
  private async assertWarehouseOperable(tx: TenantTransaction, warehouseId: string): Promise<void> {
    const warehouse = await tx.warehouse.findFirst({ where: { id: warehouseId }, select: { branchId: true } });
    if (!warehouse) throw new NotFoundException({ code: 'WAREHOUSE_NOT_FOUND', message: 'Warehouse not found' });
    const membership = await tx.membership.findFirst({
      where: { id: this.cls.get('membershipId') ?? '' },
      select: { allBranches: true, branches: { select: { branchId: true } } },
    });
    const allowed = membership?.allBranches ? null : (membership?.branches.map((b) => b.branchId) ?? []);
    if (allowed && !allowed.includes(warehouse.branchId)) {
      throw new NotFoundException({ code: 'WAREHOUSE_NOT_FOUND', message: 'Warehouse not found' });
    }
  }

  /**
   * Next `AJ-` number of the company. The advisory lock serializes numbering per company until the transaction ends,
   * so two adjustments never take the same number and a rolled-back one leaves no gap.
   */
  private async nextNumber(tx: TenantTransaction, companyId: string): Promise<string> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId}::text || ':adjustment'))`;
    const last = await tx.$queryRaw<{ ref_number: string }[]>`
      SELECT ref_number FROM stock_movements
      WHERE company_id = ${companyId}::uuid AND ref_type = ${ADJUSTMENT_REF_TYPE} AND ref_number ~ '^AJ-[0-9]{1,15}$'
      ORDER BY substring(ref_number from 4)::bigint DESC LIMIT 1`;
    return formatAdjustmentNumber((last[0] ? (parseAdjustmentNumber(last[0].ref_number) ?? 0) : 0) + 1);
  }
}
