import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../../common/cls';
import type { Env } from '../../config/env';
import { AuthService } from './auth.service';
import { clearRefreshCookie, GOOGLE_STATE_COOKIE, REFRESH_COOKIE, refreshCookieOptions } from './cookies';
import { Public } from './decorators';
import { GoogleExchangeDto, LoginDto, ForgotPasswordDto, ResetPasswordDto, SessionDto } from './dto';
import { GoogleAuthGuard } from './google-auth.guard';
import type { GoogleUser } from './google.strategy';
import type { IssuedTokens } from './tokens.service';

@ApiTags('auth')
@ApiHeader({ name: 'X-Company', description: 'company slug (rodalaser | company2)', required: false })
@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @ApiOkResponse({ type: SessionDto })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const s = await this.auth.login(this.slug(), dto.email, dto.password, this.meta());
    return this.respond(res, s);
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOkResponse({ type: SessionDto })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const s = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], this.slug(), this.meta());
      return this.respond(res, s);
    } catch (e) {
      // on a concurrent refresh the current cookie is the new one: do not clear it
      if (!(e instanceof ConflictException)) clearRefreshCookie(res, this.env());
      throw e;
    }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    clearRefreshCookie(res, this.env());
  }

  @Post('forgot-password')
  @HttpCode(204)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.requestPasswordReset(this.slug(), dto.email);
  }

  @Post('reset-password')
  @HttpCode(204)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.password);
  }

  /** Browser navigation: GET /api/v1/auth/google?company=rodalaser → Google. */
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  google() {
    // passport redirects to Google
  }

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    const state = String(req.query['state'] ?? '');
    const expected = req.cookies?.[GOOGLE_STATE_COOKIE];
    res.clearCookie(GOOGLE_STATE_COOKIE, { path: '/api/v1/auth/google' });
    const slug = state.split('.')[0] || 'rodalaser';
    const erp = this.config.get('ERP_PUBLIC_URL').replace('{company}', slug);
    const fail = (code: string) => res.redirect(`${erp}/login?error=${code}`);

    if (!state || state !== expected) return fail('GOOGLE_STATE');
    const gUser = req.user as GoogleUser | undefined;
    if (!gUser) return fail('GOOGLE_CANCELLED');
    try {
      const user = await this.auth.loginGoogle(slug, gUser);
      const code = await this.auth.createGoogleCode(user);
      return res.redirect(`${erp}/auth/callback?code=${encodeURIComponent(code)}`);
    } catch (e: any) {
      return fail(e?.response?.code ?? 'GOOGLE_ERROR');
    }
  }

  @Post('google/exchange')
  @HttpCode(200)
  @ApiOkResponse({ type: SessionDto })
  async googleExchange(@Body() dto: GoogleExchangeDto, @Res({ passthrough: true }) res: Response) {
    const s = await this.auth.exchangeGoogleCode(dto.code, this.slug(), this.meta());
    return this.respond(res, s);
  }

  // -- helpers --
  private respond(res: Response, s: IssuedTokens & { user: SessionDto['user'] }): SessionDto {
    res.cookie(REFRESH_COOKIE, s.refreshToken, refreshCookieOptions(this.env(), s.refreshMaxAgeMs));
    return { accessToken: s.accessToken, expiresIn: s.expiresIn, user: s.user };
  }

  private slug(): string {
    const slug = this.cls.get('companySlug');
    if (!slug) throw new BadRequestException({ code: 'COMPANY_REQUIRED', message: 'Missing company (X-Company header or subdomain)' });
    return slug;
  }

  private meta() {
    return { ip: this.cls.get('ip'), userAgent: this.cls.get('userAgent') };
  }

  private env() {
    return { COOKIE_SECURE: this.config.get('COOKIE_SECURE') };
  }
}
