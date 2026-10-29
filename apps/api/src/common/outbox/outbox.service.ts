import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../cls';
import { PrismaService, type TenantTransaction } from '../prisma/prisma.service';

/** Known event types. The worker routes each type to a queue (see apps/worker/src/outbox). */
export type OutboxType =
  | 'auth.password-reset'
  | 'auth.invitation'
  | 'sale.confirmed'
  | 'invoice.issue'
  | 'invoice.cancel'
  | 'entry.generate'
  | 'inventory.product-created'
  | 'inventory.product-updated'
  | 'inventory.product-status-changed'
  | 'inventory.stock.changed'
  | 'inventory.warehouse.changed'
  | 'inventory.transfer.sent';

type Tx = Prisma.TransactionClient | PrismaService | TenantTransaction;

@Injectable()
export class OutboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  /**
   * Enqueues an event. ALWAYS pass the `tx` of the business change's transaction:
   * if the transaction rolls back, the event does not exist either.
   */
  async publish(
    type: OutboxType,
    payload: Record<string, unknown>,
    opts: { tx?: Tx; idempotencyKey?: string; companyId?: string | null; availableAt?: Date } = {},
  ) {
    const tx = opts.tx ?? this.prisma;
    return tx.outboxEvent.create({
      data: {
        type,
        payload: payload as Prisma.InputJsonValue,
        idempotencyKey: opts.idempotencyKey,
        companyId: opts.companyId ?? this.cls.get('companyId'),
        availableAt: opts.availableAt,
      },
    });
  }
}
