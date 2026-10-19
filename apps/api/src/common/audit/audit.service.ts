import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../cls';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  accion: string;
  entidad?: string;
  entidadId?: string;
  antes?: unknown;
  despues?: unknown;
  empresaId?: string | null;
  usuarioId?: string | null;
}

type Tx = Prisma.TransactionClient | PrismaService;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  /** Registrar dentro de la transacción del cambio cuando sea posible (`tx`). */
  async log(entry: AuditEntry, tx: Tx = this.prisma): Promise<void> {
    try {
      await tx.auditLog.create({
        data: {
          accion: entry.accion,
          entidad: entry.entidad,
          entidadId: entry.entidadId,
          antes: (entry.antes ?? undefined) as Prisma.InputJsonValue | undefined,
          despues: (entry.despues ?? undefined) as Prisma.InputJsonValue | undefined,
          empresaId: entry.empresaId ?? this.cls.get('empresaId'),
          usuarioId: entry.usuarioId ?? this.cls.get('usuarioId'),
          ip: this.cls.get('ip'),
          userAgent: this.cls.get('userAgent'),
        },
      });
    } catch (err) {
      // la auditoría nunca debe tumbar una operación fuera de transacción
      if (tx !== this.prisma) throw err;
      this.logger.error(`No se pudo auditar ${entry.accion}`, err as Error);
    }
  }
}
