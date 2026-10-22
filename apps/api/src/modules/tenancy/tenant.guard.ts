import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../../common/cls';
import { IS_PUBLIC } from '../auth/decorators';
import type { JwtUser } from '../auth/jwt.strategy';
import { CompaniesService } from './companies.service';

/**
 * After authenticating: the requested company (URL/header) must be the same as the token's.
 * Prevents using a Rodalaser session against Company 2's URL and vice versa.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService<AppClsStore>,
    private readonly companies: CompaniesService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const user = ctx.switchToHttp().getRequest().user as JwtUser | undefined;
    if (!user) return false;
    const slug = this.cls.get('companySlug');
    if (slug) {
      const companyId = await this.companies.idBySlug(slug);
      if (companyId !== user.cid) {
        throw new ForbiddenException({ code: 'COMPANY_MISMATCH', message: 'The session belongs to another company' });
      }
    }
    this.cls.set('companyId', user.cid);
    this.cls.set('userId', user.sub);
    this.cls.set('membershipId', user.mid);
    return true;
  }
}
