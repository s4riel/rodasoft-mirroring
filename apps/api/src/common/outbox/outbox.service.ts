import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../cls';
import { PrismaService } from '../prisma/prisma.service';

/** Tipos de evento conocidos. El worker enruta cada tipo a una cola (ver apps/worker/src/outbox). */
export type OutboxTipo =
  | 'auth.password-reset'
  | 'auth.invitacion'
  | 'venta.confirmada'
  | 'factura.emitir'
  | 'factura.anular'
  | 'asiento.generar';

type Tx = Prisma.TransactionClient | PrismaService;

@Injectable()
export class OutboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  /**
   * Encola un evento. Pasar SIEMPRE el `tx` de la transacción del cambio de negocio:
   * si la transacción se revierte, el evento tampoco existe.
   */
  async publish(
    tipo: OutboxTipo,
    payload: Record<string, unknown>,
    opts: { tx?: Tx; idempotencyKey?: string; empresaId?: string | null; disponibleEn?: Date } = {},
  ) {
    const tx = opts.tx ?? this.prisma;
    return tx.outboxEvent.create({
      data: {
        tipo,
        payload: payload as Prisma.InputJsonValue,
        idempotencyKey: opts.idempotencyKey,
        empresaId: opts.empresaId ?? this.cls.get('empresaId'),
        disponibleEn: opts.disponibleEn,
      },
    });
  }
}
