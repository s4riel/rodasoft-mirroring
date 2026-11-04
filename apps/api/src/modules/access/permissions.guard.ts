import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@rodasoft/domain';
import type { JwtUser } from '../auth/jwt.strategy';
import { MembershipService } from './membership.service';
import { REQUIRED_ANY_PERMISSIONS, REQUIRED_PERMISSIONS } from './require-permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly membership: MembershipService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS, targets);
    const anyOf = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_ANY_PERMISSIONS, targets);
    // a method-level `@RequirePermissions` replaces the class-level one; "any of" is an extra, independent rule
    if (!required?.length && !anyOf?.length) return true;
    const user = ctx.switchToHttp().getRequest().user as JwtUser | undefined;
    if (!user) return false;
    const granted = await this.membership.permissions(user.mid);
    const missing = (required ?? []).filter((p) => !granted.has(p));
    if (missing.length) {
      throw new ForbiddenException({ code: 'NO_PERMISSION', message: 'You do not have permission for this action', details: { missing } });
    }
    if (anyOf?.length && !anyOf.some((p) => granted.has(p))) {
      throw new ForbiddenException({ code: 'NO_PERMISSION', message: 'You do not have permission for this action', details: { missing: anyOf, anyOf: true } });
    }
    return true;
  }
}
