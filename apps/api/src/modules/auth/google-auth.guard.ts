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
 * Inicio: genera `state = <empresa>.<nonce>` y lo guarda en una cookie httpOnly de 10 minutos.
 * Callback: el controlador compara `state` con la cookie (protección CSRF) antes de aceptar.
 * Si el usuario cancela en Google, `req.user` queda vacío y el controlador redirige con un error.
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
      throw new ServiceUnavailableException({ code: 'GOOGLE_NO_CONFIGURADO', message: 'El acceso con Google no está configurado' });
    }
    return super.canActivate(ctx);
  }

  override getAuthenticateOptions(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (req.query['code'] || req.query['error']) return {};
    const slug = this.cls.get('empresaSlug') ?? 'rodalaser';
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
    return user; // los errores se resuelven en el controlador con una redirección al ERP
  }
}
