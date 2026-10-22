import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../cls';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  action: string;
  entity?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  companyId?: string | null;
  userId?: string | null;
}

type Tx = Prisma.TransactionClient | PrismaService;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  /** Log inside the change's transaction whenever possible (`tx`). */
  async log(entry: AuditEntry, tx: Tx = this.prisma): Promise<void> {
    try {
      await tx.auditLog.create({
        data: {
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId,
          before: (entry.before ?? undefined) as Prisma.InputJsonValue | undefined,
          after: (entry.after ?? undefined) as Prisma.InputJsonValue | undefined,
          companyId: entry.companyId ?? this.cls.get('companyId'),
          userId: entry.userId ?? this.cls.get('userId'),
          ip: this.cls.get('ip'),
          userAgent: this.cls.get('userAgent'),
        },
      });
    } catch (err) {
      // auditing must never bring down an operation outside a transaction
      if (tx !== this.prisma) throw err;
      this.logger.error(`Could not audit ${entry.action}`, err as Error);
    }
  }
}
