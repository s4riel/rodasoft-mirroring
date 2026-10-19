import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { EstadoRegistro } from '@prisma/client';
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
  if (!m) throw new Error(`TTL inválido: ${ttl}`);
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

  async issue(user: JwtUser, meta: ClientMeta, familia: string = randomUUID()): Promise<IssuedTokens> {
    const expiresIn = ttlToSeconds(this.config.get('JWT_ACCESS_TTL'));
    const accessToken = await this.jwt.signAsync(
      { sub: user.sub, emp: user.emp, mid: user.mid },
      { expiresIn, issuer: 'rodasoft', audience: 'rodasoft-erp' },
    );
    const refreshToken = randomToken(48);
    const refreshMaxAgeMs = this.config.get('JWT_REFRESH_TTL_DAYS') * 86_400_000;
    await this.prisma.refreshToken.create({
      data: {
        usuarioId: user.sub,
        empresaId: user.emp,
        familia,
        tokenHash: sha256(refreshToken),
        expiraEn: new Date(Date.now() + refreshMaxAgeMs),
        ip: meta.ip ?? undefined,
        userAgent: meta.userAgent?.slice(0, 300) ?? undefined,
      },
    });
    return { accessToken, expiresIn, refreshToken, refreshMaxAgeMs };
  }

  /**
   * Rota el refresh token. Si se presenta uno ya usado o revocado, se revoca toda la familia
   * (alguien más lo tiene) y se obliga a iniciar sesión de nuevo.
   */
  async rotate(raw: string | undefined, empresaId: string, meta: ClientMeta): Promise<IssuedTokens & { user: JwtUser }> {
    const invalid = () => new UnauthorizedException({ code: 'SESION_INVALIDA', message: 'Tu sesión expiró. Inicia sesión de nuevo.' });
    if (!raw) throw invalid();
    const token = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
    if (!token || token.empresaId !== empresaId) throw invalid();

    // Dos pestañas refrescando a la vez: la segunda llega con el token recién rotado por la primera.
    // Dentro de 30 s no es robo: se responde 409 sin revocar ni borrar la cookie nueva.
    if (token.usadoEn && !token.revocadoEn && Date.now() - token.usadoEn.getTime() < 30_000) {
      throw new ConflictException({ code: 'REFRESH_CONCURRENTE', message: 'La sesión se renovó en otra pestaña' });
    }
    if (token.usadoEn || token.revocadoEn) {
      await this.revokeFamily(token.familia);
      await this.audit.log({ accion: 'auth.refresh.reutilizado', usuarioId: token.usuarioId, empresaId, entidad: 'refresh_token', entidadId: token.id });
      throw invalid();
    }
    if (token.expiraEn < new Date()) throw invalid();

    const membresia = await this.prisma.membresia.findFirst({
      where: { usuarioId: token.usuarioId, empresaId, estado: EstadoRegistro.ACTIVO, usuario: { estado: EstadoRegistro.ACTIVO } },
      select: { id: true },
    });
    if (!membresia) {
      await this.revokeFamily(token.familia);
      throw invalid();
    }

    // marcar como usado de forma atómica (dos pestañas refrescando a la vez: solo una gana)
    const marked = await this.prisma.refreshToken.updateMany({
      where: { id: token.id, usadoEn: null },
      data: { usadoEn: new Date() },
    });
    if (marked.count === 0) {
      throw new ConflictException({ code: 'REFRESH_CONCURRENTE', message: 'La sesión se renovó en otra pestaña' });
    }

    const user: JwtUser = { sub: token.usuarioId, emp: empresaId, mid: membresia.id };
    return { ...(await this.issue(user, meta, token.familia)), user };
  }

  async revoke(raw: string | undefined) {
    if (!raw) return;
    const token = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
    if (token) await this.revokeFamily(token.familia);
  }

  async revokeAllForUser(usuarioId: string) {
    await this.prisma.refreshToken.updateMany({ where: { usuarioId, revocadoEn: null }, data: { revocadoEn: new Date() } });
  }

  private revokeFamily(familia: string) {
    return this.prisma.refreshToken.updateMany({ where: { familia, revocadoEn: null }, data: { revocadoEn: new Date() } });
  }
}
