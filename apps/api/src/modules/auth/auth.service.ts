import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RecordStatus } from '@prisma/client';
import { hash, verify } from 'argon2';
import Redis from 'ioredis';
import { AuditService } from '../../common/audit/audit.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InjectRedis } from '../../common/redis/redis.provider';
import { randomToken, sha256 } from '../../common/security/secrets.service';
import type { Env } from '../../config/env';
import { CompaniesService } from '../tenancy/companies.service';
import type { GoogleUser } from './google.strategy';
import type { JwtUser } from './jwt.strategy';
import { ClientMeta, TokensService } from './tokens.service';

/** Error codes the ERP translates into screens (BC-01b, BC-04, BC-08b). */
export const AuthErrors = {
  invalidCredentials: () => new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Incorrect e-mail or password' }),
  noAccess: () => new ForbiddenException({ code: 'NO_ACCESS', message: 'Your account has no access to this company' }),
  accountDisabled: () => new ForbiddenException({ code: 'ACCOUNT_DISABLED', message: 'Your account is disabled. Contact the administrator.' }),
};

@Injectable()
export class AuthService {
  /** filler hash: equalizes response time when the e-mail does not exist */
  private readonly dummyHash = hash(randomToken(16));

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly companies: CompaniesService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService<Env, true>,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async login(slug: string, email: string, password: string, meta: ClientMeta) {
    const companyId = await this.companies.idBySlug(slug);
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    const ok = await verify(user?.passwordHash ?? (await this.dummyHash), password).catch(() => false);
    if (!user || !user.passwordHash || !ok) {
      await this.audit.log({ action: 'auth.login.failed', companyId, userId: user?.id, after: { email } });
      throw AuthErrors.invalidCredentials();
    }
    return this.sessionFor(await this.authorize(user.id, companyId, 'auth.login'), meta);
  }

  /** Validates the Google account and returns who it maps to; the session is opened later in /google/exchange. */
  async loginGoogle(slug: string, g: GoogleUser): Promise<JwtUser> {
    const companyId = await this.companies.idBySlug(slug);
    if (!g.email || !g.emailVerified) throw AuthErrors.noAccess();
    const hd = this.config.get('GOOGLE_ALLOWED_HD');
    if (hd && g.hd !== hd) throw AuthErrors.noAccess();

    // Only e-mails invited from Settings → Users get in (pending confirmation with the client).
    const user =
      (await this.prisma.user.findUnique({ where: { googleSub: g.sub } })) ??
      (await this.prisma.user.findUnique({ where: { email: g.email } }));
    if (!user) throw AuthErrors.noAccess();
    if (!user.googleSub || !user.avatarUrl) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { googleSub: user.googleSub ?? g.sub, avatarUrl: user.avatarUrl ?? g.avatarUrl },
      });
    }
    return this.authorize(user.id, companyId, 'auth.login.google');
  }

  /** One-time code (60 s) to hand the Google session from the API domain over to the ERP's. */
  async createGoogleCode(user: JwtUser): Promise<string> {
    const code = randomToken(24);
    await this.redis.set(`gauth:${sha256(code)}`, JSON.stringify(user), 'EX', 60);
    return code;
  }

  async exchangeGoogleCode(code: string, slug: string, meta: ClientMeta) {
    const raw = await this.redis.getdel(`gauth:${sha256(code)}`);
    if (!raw) throw new UnauthorizedException({ code: 'INVALID_CODE', message: 'The sign-in link expired. Try again.' });
    const user = JSON.parse(raw) as JwtUser;
    if (user.cid !== (await this.companies.idBySlug(slug))) throw AuthErrors.noAccess();
    return this.sessionFor(user, meta);
  }

  async refresh(raw: string | undefined, slug: string, meta: ClientMeta) {
    const companyId = await this.companies.idBySlug(slug);
    const rotated = await this.tokens.rotate(raw, companyId, meta);
    return { ...rotated, user: await this.publicUser(rotated.user.sub) };
  }

  logout(raw: string | undefined) {
    return this.tokens.revoke(raw);
  }

  /** Always answers the same whether or not the e-mail exists (does not reveal which accounts exist). */
  async requestPasswordReset(slug: string, email: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user || user.status !== RecordStatus.ACTIVE) return;
    const token = randomToken(32);
    await this.prisma.$transaction(async (tx) => {
      await tx.passwordReset.create({
        data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 30 * 60_000) },
      });
      const url = `${this.config.get('ERP_PUBLIC_URL').replace('{company}', slug)}/reset-password?token=${token}`;
      await this.outbox.publish('auth.password-reset', { email: user.email, name: user.name, url }, { tx, companyId: null });
    });
  }

  async resetPassword(token: string, password: string) {
    const reset = await this.prisma.passwordReset.findUnique({ where: { tokenHash: sha256(token) } });
    if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
      throw new UnauthorizedException({ code: 'INVALID_LINK', message: 'The link expired or was already used' });
    }
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: reset.userId }, data: { passwordHash: await hash(password) } }),
      this.prisma.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
    ]);
    await this.tokens.revokeAllForUser(reset.userId);
    await this.audit.log({ action: 'auth.password.reset', userId: reset.userId, companyId: null });
  }

  private async authorize(userId: string, companyId: string, action: string): Promise<JwtUser> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.status !== RecordStatus.ACTIVE) throw AuthErrors.accountDisabled();
    const membership = await this.prisma.membership.findUnique({
      where: { companyId_userId: { companyId, userId } },
    });
    if (!membership) throw AuthErrors.noAccess();
    if (membership.status !== RecordStatus.ACTIVE) throw AuthErrors.accountDisabled();

    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    await this.audit.log({ action, companyId, userId });
    return { sub: userId, cid: companyId, mid: membership.id };
  }

  private async sessionFor(user: JwtUser, meta: ClientMeta) {
    const issued = await this.tokens.issue(user, meta);
    return { ...issued, user: await this.publicUser(user.sub) };
  }

  private publicUser(id: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id },
      select: { id: true, email: true, name: true, avatarUrl: true },
    });
  }
}
