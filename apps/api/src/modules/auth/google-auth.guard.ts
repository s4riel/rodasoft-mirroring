import { ExecutionContext, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../../common/cls';
import { randomToken } from '../../common/security/secrets.service';
import type { Env } from '../../config/env';
import { GOOGLE_STATE_COOKIE } from './cookies';

/**
 * Start: generates `state = <company>.<nonce>` and stores it in a 10-minute httpOnly cookie.
 * Callback: the controller compares `state` with the cookie (CSRF protection) before accepting.
 * If the user cancels at Google, `req.user` stays empty and the controller redirects with an error.
 */
@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly cls: ClsService<AppClsStore>,
  ) {
    super();
  }

  override canActivate(ctx: ExecutionContext) {
    if (!this.config.get('GOOGLE_CLIENT_ID')) {
      throw new ServiceUnavailableException({ code: 'GOOGLE_NOT_CONFIGURED', message: 'Google sign-in is not configured' });
    }
    return super.canActivate(ctx);
  }

  override getAuthenticateOptions(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (req.query['code'] || req.query['error']) return {};
    const slug = this.cls.get('companySlug') ?? 'rodalaser';
    const state = `${slug}.${randomToken(16)}`;
    ctx
      .switchToHttp()
      .getResponse<Response>()
      .cookie(GOOGLE_STATE_COOKIE, state, {
        httpOnly: true,
        secure: this.config.get('COOKIE_SECURE'),
        sameSite: 'lax',
        path: '/api/v1/auth/google',
        maxAge: 10 * 60 * 1000,
      });
    const hd = this.config.get('GOOGLE_ALLOWED_HD');
    return { state, prompt: 'select_account', ...(hd ? { hd } : {}) };
  }

  override handleRequest<T>(_err: unknown, user: T): T {
    return user; // errors are handled in the controller with a redirect to the ERP
  }
}
