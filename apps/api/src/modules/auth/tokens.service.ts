import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RecordStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { randomToken, sha256 } from '../../common/security/secrets.service';
import type { Env } from '../../config/env';
import type { JwtUser } from './jwt.strategy';

export interface ClientMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshMaxAgeMs: number;
}

/** "15m" → 900 */
export function ttlToSeconds(ttl: string): number {
  const m = /^(\d+)\s*([smhd])?$/.exec(ttl.trim());
  if (!m) throw new Error(`Invalid TTL: ${ttl}`);
  const n = Number(m[1]);
  return n * ({ s: 1, m: 60, h: 3600, d: 86400 } as const)[(m[2] ?? 's') as 's' | 'm' | 'h' | 'd'];
}

@Injectable()
export class TokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly audit: AuditService,
  ) {}

  async issue(user: JwtUser, meta: ClientMeta, familyId: string = randomUUID()): Promise<IssuedTokens> {
    const expiresIn = ttlToSeconds(this.config.get('JWT_ACCESS_TTL'));
    const accessToken = await this.jwt.signAsync(
      { sub: user.sub, cid: user.cid, mid: user.mid },
      { expiresIn, issuer: 'rodasoft', audience: 'rodasoft-erp' },
    );
    const refreshToken = randomToken(48);
    const refreshMaxAgeMs = this.config.get('JWT_REFRESH_TTL_DAYS') * 86_400_000;
    await this.prisma.refreshToken.create({
      data: {
        userId: user.sub,
        companyId: user.cid,
        familyId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + refreshMaxAgeMs),
        ip: meta.ip ?? undefined,
        userAgent: meta.userAgent?.slice(0, 300) ?? undefined,
      },
    });
    return { accessToken, expiresIn, refreshToken, refreshMaxAgeMs };
  }

  /**
   * Rotates the refresh token. If an already used or revoked one is presented, the whole family
   * is revoked (someone else has it) and a new sign-in is required.
   */
  async rotate(raw: string | undefined, companyId: string, meta: ClientMeta): Promise<IssuedTokens & { user: JwtUser }> {
    const invalid = () => new UnauthorizedException({ code: 'INVALID_SESSION', message: 'Your session expired. Sign in again.' });
    if (!raw) throw invalid();
    const token = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
    if (!token || token.companyId !== companyId) throw invalid();

    // Two tabs refreshing at once: the second arrives with the token just rotated by the first.
    // Within 30 s this is not theft: answer 409 without revoking or clearing the new cookie.
    if (token.usedAt && !token.revokedAt && Date.now() - token.usedAt.getTime() < 30_000) {
      throw new ConflictException({ code: 'CONCURRENT_REFRESH', message: 'The session was renewed in another tab' });
    }
    if (token.usedAt || token.revokedAt) {
      await this.revokeFamily(token.familyId);
      await this.audit.log({ action: 'auth.refresh.reused', userId: token.userId, companyId, entity: 'refresh_token', entityId: token.id });
      throw invalid();
    }
    if (token.expiresAt < new Date()) throw invalid();

    const membership = await this.prisma.membership.findFirst({
      where: { userId: token.userId, companyId, status: RecordStatus.ACTIVE, user: { status: RecordStatus.ACTIVE } },
      select: { id: true },
    });
    if (!membership) {
      await this.revokeFamily(token.familyId);
      throw invalid();
    }

    // mark as used atomically (two tabs refreshing at once: only one wins)
    const marked = await this.prisma.refreshToken.updateMany({
      where: { id: token.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (marked.count === 0) {
      throw new ConflictException({ code: 'CONCURRENT_REFRESH', message: 'The session was renewed in another tab' });
    }

    const user: JwtUser = { sub: token.userId, cid: companyId, mid: membership.id };
    return { ...(await this.issue(user, meta, token.familyId)), user };
  }

  async revoke(raw: string | undefined) {
    if (!raw) return;
    const token = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
    if (token) await this.revokeFamily(token.familyId);
  }

  async revokeAllForUser(userId: string) {
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private revokeFamily(familyId: string) {
    return this.prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
