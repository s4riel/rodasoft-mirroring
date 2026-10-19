import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../../common/cls';
import { IS_PUBLIC } from '../auth/decorators';
import type { JwtUser } from '../auth/jwt.strategy';
import { EmpresasService } from './empresas.service';

/**
 * Después de autenticar: la empresa pedida (URL/encabezado) debe ser la misma del token.
 * Evita usar una sesión de Rodalaser contra la URL de la Empresa 2 y viceversa.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService<AppClsStore>,
    private readonly empresas: EmpresasService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const user = ctx.switchToHttp().getRequest().user as JwtUser | undefined;
    if (!user) return false;
    const slug = this.cls.get('empresaSlug');
    if (slug) {
      const empresaId = await this.empresas.idBySlug(slug);
      if (empresaId !== user.emp) {
        throw new ForbiddenException({ code: 'EMPRESA_DISTINTA', message: 'La sesión pertenece a otra empresa' });
      }
    }
    this.cls.set('empresaId', user.emp);
    this.cls.set('usuarioId', user.sub);
    this.cls.set('membresiaId', user.mid);
    return true;
  }
}
