import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { JwtUser } from './jwt.strategy';

export const IS_PUBLIC = 'isPublic';
/** Ruta sin autenticación (login, salud, datos públicos de la empresa). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): JwtUser => ctx.switchToHttp().getRequest().user,
);
