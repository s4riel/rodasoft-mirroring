import { Injectable } from '@nestjs/common';
import type { Permission } from '@rodasoft/domain';
import { PrismaService } from '../../common/prisma/prisma.service';

const TTL_MS = 30_000;

/** Effective permissions of a membership, with a short cache (a role change shows up within 30 s). */
@Injectable()
export class MembershipService {
  private cache = new Map<string, { at: number; permissions: Set<Permission> }>();

  constructor(private readonly prisma: PrismaService) {}

  async permissions(membershipId: string): Promise<Set<Permission>> {
    const hit = this.cache.get(membershipId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.permissions;
    const m = await this.prisma.membership.findUnique({
      where: { id: membershipId },
      select: { status: true, role: { select: { permissions: { select: { permissionKey: true } } } } },
    });
    const permissions = new Set<Permission>(
      m && m.status === 'ACTIVE' ? m.role.permissions.map((p) => p.permissionKey as Permission) : [],
    );
    this.cache.set(membershipId, { at: Date.now(), permissions });
    return permissions;
  }

  invalidate(membershipId?: string) {
    if (membershipId) this.cache.delete(membershipId);
    else this.cache.clear();
  }
}
