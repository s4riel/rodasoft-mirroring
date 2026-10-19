import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EstadoRegistro } from '@prisma/client';
import { hash, verify } from 'argon2';
import Redis from 'ioredis';
import { AuditService } from '../../common/audit/audit.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InjectRedis } from '../../common/redis/redis.provider';
import { randomToken, sha256 } from '../../common/security/secrets.service';
import type { Env } from '../../config/env';
import { EmpresasService } from '../tenancy/empresas.service';
import type { GoogleUser } from './google.strategy';
import type { JwtUser } from './jwt.strategy';
import { ClientMeta, TokensService } from './tokens.service';

/** Códigos de error que el ERP traduce a pantallas (BC-01b, BC-04, BC-08b). */
export const AuthErrors = {
  credenciales: () => new UnauthorizedException({ code: 'CREDENCIALES', message: 'Correo o contraseña incorrectos' }),
  sinAcceso: () => new ForbiddenException({ code: 'SIN_ACCESO', message: 'Tu cuenta no tiene acceso a esta empresa' }),
  desactivada: () => new ForbiddenException({ code: 'CUENTA_DESACTIVADA', message: 'Tu cuenta está desactivada. Habla con el administrador.' }),
};

@Injectable()
export class AuthService {
  /** hash de relleno: iguala el tiempo de respuesta cuando el correo no existe */
  private readonly dummyHash = hash(randomToken(16));

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly empresas: EmpresasService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService<Env, true>,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async login(slug: string, email: string, password: string, meta: ClientMeta) {
    const empresaId = await this.empresas.idBySlug(slug);
    const usuario = await this.prisma.usuario.findUnique({ where: { email: email.trim().toLowerCase() } });
    const ok = await verify(usuario?.passwordHash ?? (await this.dummyHash), password).catch(() => false);
    if (!usuario || !usuario.passwordHash || !ok) {
      await this.audit.log({ accion: 'auth.login.fallido', empresaId, usuarioId: usuario?.id, despues: { email } });
      throw AuthErrors.credenciales();
    }
    return this.sessionFor(await this.authorize(usuario.id, empresaId, 'auth.login'), meta);
  }

  /** Valida la cuenta de Google y devuelve a quién corresponde; la sesión se abre después en /google/exchange. */
  async loginGoogle(slug: string, g: GoogleUser): Promise<JwtUser> {
    const empresaId = await this.empresas.idBySlug(slug);
    if (!g.email || !g.emailVerified) throw AuthErrors.sinAcceso();
    const hd = this.config.get('GOOGLE_ALLOWED_HD');
    if (hd && g.hd !== hd) throw AuthErrors.sinAcceso();

    // Solo entran correos invitados desde Configuración → Usuarios (pendiente de confirmar con el cliente).
    const usuario =
      (await this.prisma.usuario.findUnique({ where: { googleSub: g.sub } })) ??
      (await this.prisma.usuario.findUnique({ where: { email: g.email } }));
    if (!usuario) throw AuthErrors.sinAcceso();
    if (!usuario.googleSub || !usuario.avatarUrl) {
      await this.prisma.usuario.update({
        where: { id: usuario.id },
        data: { googleSub: usuario.googleSub ?? g.sub, avatarUrl: usuario.avatarUrl ?? g.avatarUrl },
      });
    }
    return this.authorize(usuario.id, empresaId, 'auth.login.google');
  }

  /** Código de un solo uso (60 s) para pasar la sesión de Google del dominio de la API al del ERP. */
  async createGoogleCode(user: JwtUser): Promise<string> {
    const code = randomToken(24);
    await this.redis.set(`gauth:${sha256(code)}`, JSON.stringify(user), 'EX', 60);
    return code;
  }

  async exchangeGoogleCode(code: string, slug: string, meta: ClientMeta) {
    const raw = await this.redis.getdel(`gauth:${sha256(code)}`);
    if (!raw) throw new UnauthorizedException({ code: 'CODIGO_INVALIDO', message: 'El enlace de acceso expiró. Intenta de nuevo.' });
    const user = JSON.parse(raw) as JwtUser;
    if (user.emp !== (await this.empresas.idBySlug(slug))) throw AuthErrors.sinAcceso();
    return this.sessionFor(user, meta);
  }

  async refresh(raw: string | undefined, slug: string, meta: ClientMeta) {
    const empresaId = await this.empresas.idBySlug(slug);
    const rotated = await this.tokens.rotate(raw, empresaId, meta);
    return { ...rotated, usuario: await this.usuarioPublico(rotated.user.sub) };
  }

  logout(raw: string | undefined) {
    return this.tokens.revoke(raw);
  }

  /** Siempre responde igual exista o no el correo (no revela qué cuentas existen). */
  async solicitarRecuperacion(slug: string, email: string) {
    const usuario = await this.prisma.usuario.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!usuario || usuario.estado !== EstadoRegistro.ACTIVO) return;
    const token = randomToken(32);
    await this.prisma.$transaction(async (tx) => {
      await tx.passwordReset.create({
        data: { usuarioId: usuario.id, tokenHash: sha256(token), expiraEn: new Date(Date.now() + 30 * 60_000) },
      });
      const url = `${this.config.get('ERP_PUBLIC_URL').replace('{empresa}', slug)}/recuperar/restablecer?token=${token}`;
      await this.outbox.publish('auth.password-reset', { email: usuario.email, nombre: usuario.nombre, url }, { tx, empresaId: null });
    });
  }

  async restablecer(token: string, password: string) {
    const reset = await this.prisma.passwordReset.findUnique({ where: { tokenHash: sha256(token) } });
    if (!reset || reset.usadoEn || reset.expiraEn < new Date()) {
      throw new UnauthorizedException({ code: 'ENLACE_INVALIDO', message: 'El enlace expiró o ya fue usado' });
    }
    await this.prisma.$transaction([
      this.prisma.usuario.update({ where: { id: reset.usuarioId }, data: { passwordHash: await hash(password) } }),
      this.prisma.passwordReset.update({ where: { id: reset.id }, data: { usadoEn: new Date() } }),
    ]);
    await this.tokens.revokeAllForUser(reset.usuarioId);
    await this.audit.log({ accion: 'auth.password.restablecida', usuarioId: reset.usuarioId, empresaId: null });
  }

  private async authorize(usuarioId: string, empresaId: string, accion: string): Promise<JwtUser> {
    const usuario = await this.prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
    if (usuario.estado !== EstadoRegistro.ACTIVO) throw AuthErrors.desactivada();
    const membresia = await this.prisma.membresia.findUnique({
      where: { empresaId_usuarioId: { empresaId, usuarioId } },
    });
    if (!membresia) throw AuthErrors.sinAcceso();
    if (membresia.estado !== EstadoRegistro.ACTIVO) throw AuthErrors.desactivada();

    await this.prisma.usuario.update({ where: { id: usuarioId }, data: { ultimoAcceso: new Date() } });
    await this.audit.log({ accion, empresaId, usuarioId });
    return { sub: usuarioId, emp: empresaId, mid: membresia.id };
  }

  private async sessionFor(user: JwtUser, meta: ClientMeta) {
    const issued = await this.tokens.issue(user, meta);
    return { ...issued, usuario: await this.usuarioPublico(user.sub) };
  }

  private usuarioPublico(id: string) {
    return this.prisma.usuario.findUniqueOrThrow({
      where: { id },
      select: { id: true, email: true, nombre: true, avatarUrl: true },
    });
  }
}
