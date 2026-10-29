import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { type TransferDifference, TRANSFER_DIFFERENCE_REASON, totalDifferenceValue } from '@rodasoft/domain';
import { AuditService } from '../../common/audit/audit.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import type { TenantTransaction } from '../../common/prisma/prisma.service';
import { nextAdjustmentNumber } from './adjustment-number';

/**
 * Stock adjustment documents (minimal in HU-INV-21; HU-INV-22 and HU-INV-23 extend it with the manual form and the approval).
 * Creating a document writes no stock: a transfer's shortage never entered a warehouse and its surplus is not in stock until
 * the adjustment is approved, so this service never calls `StockMovementService`.
 */
@Injectable()
export class AdjustmentDocumentsService {
  constructor(
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * The pending adjustment for the differences of a closed transfer receipt: one document per transfer, one line per
   * product that did not match, at the destination warehouse. Run it inside the transaction of the close.
   */
  async createFromTransfer(
    tx: TenantTransaction,
    input: {
      companyId: string;
      userId: string | null;
      transfer: { id: string; number: string; destinationWarehouseId: string };
      differences: readonly TransferDifference[];
    },
  ): Promise<{ id: string; number: string; totalValue: string }> {
    const { companyId, userId, transfer, differences } = input;
    const number = await nextAdjustmentNumber(tx, companyId);
    const totalValue = totalDifferenceValue(differences);

    const adjustment = await tx.stockAdjustment.create({
      select: { id: true },
      data: {
        companyId,
        number,
        source: 'TRANSFER',
        transferId: transfer.id,
        warehouseId: transfer.destinationWarehouseId,
        reason: TRANSFER_DIFFERENCE_REASON,
        totalValue,
        createdById: userId,
      },
    });
    await tx.stockAdjustmentItem.createMany({
      data: differences.map((d) => ({
        companyId,
        adjustmentId: adjustment.id,
        productId: d.productId,
        kind: d.kind,
        quantity: d.quantity,
        unitCost: d.unitCost,
      })),
    });

    await this.audit.log(
      {
        action: 'inventory.adjustment.create',
        entity: 'StockAdjustment',
        entityId: adjustment.id,
        after: {
          number,
          status: 'PENDING_APPROVAL',
          source: 'TRANSFER',
          transferId: transfer.id,
          transferNumber: transfer.number,
          warehouseId: transfer.destinationWarehouseId,
          lines: differences.length,
          totalValue,
        },
      },
      tx as unknown as Prisma.TransactionClient,
    );
    await this.outbox.publish(
      'inventory.adjustment.pending',
      { adjustmentId: adjustment.id, number, source: 'TRANSFER', transferId: transfer.id, warehouseId: transfer.destinationWarehouseId, totalValue, userId },
      { tx, companyId, idempotencyKey: `inventory.adjustment.pending:${adjustment.id}` },
    );
    return { id: adjustment.id, number, totalValue };
  }
}
