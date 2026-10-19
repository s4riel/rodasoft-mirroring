import { Injectable } from '@nestjs/common';
import type { Permission } from '@rodasoft/domain';
import { PrismaService } from '../../common/prisma/prisma.service';

const TTL_MS = 30_000;

/** Permisos efectivos de una membresía, con caché corta (un cambio de rol se nota en ≤ 30 s). */
@Injectable()
export class MembershipService {
  private cache = new Map<string, { at: number; permisos: Set<Permission> }>();

  constructor(private readonly prisma: PrismaService) {}

  async permisos(membresiaId: string): Promise<Set<Permission>> {
    const hit = this.cache.get(membresiaId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.permisos;
    const m = await this.prisma.membresia.findUnique({
      where: { id: membresiaId },
      select: { estado: true, rol: { select: { permisos: { select: { permisoClave: true } } } } },
    });
    const permisos = new Set<Permission>(
      m && m.estado === 'ACTIVO' ? m.rol.permisos.map((p) => p.permisoClave as Permission) : [],
    );
    this.cache.set(membresiaId, { at: Date.now(), permisos });
    return permisos;
  }

  invalidate(membresiaId?: string) {
    if (membresiaId) this.cache.delete(membresiaId);
    else this.cache.clear();
  }
}
