import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { ContextoResponse, Permission } from '@rodasoft/domain';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CurrentUser } from '../auth/decorators';
import type { JwtUser } from '../auth/jwt.strategy';
import { MembershipService } from './membership.service';

@ApiTags('contexto')
@ApiBearerAuth()
@Controller('contexto')
export class ContextoController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly membership: MembershipService,
  ) {}

  /** Lo que el ERP necesita al arrancar: usuario, empresa (etiqueta fija), sucursales permitidas, rol y permisos. */
  @Get()
  async get(@CurrentUser() user: JwtUser): Promise<ContextoResponse> {
    const m = await this.prisma.tenant.membresia.findUniqueOrThrow({
      where: { id: user.mid },
      include: {
        usuario: { select: { id: true, email: true, nombre: true, avatarUrl: true } },
        empresa: true,
        rol: { select: { clave: true, nombre: true } },
        sucursales: { select: { sucursalId: true } },
      },
    });
    const sucursales = await this.prisma.tenant.sucursal.findMany({
      where: {
        estado: 'ACTIVO',
        ...(m.todasSucursales ? {} : { id: { in: m.sucursales.map((s) => s.sucursalId) } }),
      },
      orderBy: { codigo: 'asc' },
      include: { almacenes: { where: { estado: 'ACTIVO' }, orderBy: { codigo: 'asc' } } },
    });
    return {
      usuario: m.usuario,
      empresa: {
        id: m.empresa.id,
        slug: m.empresa.slug,
        razonSocial: m.empresa.razonSocial,
        nombreComercial: m.empresa.nombreComercial,
        nit: m.empresa.nit,
        brand: m.empresa.brand,
      },
      sucursales: sucursales.map((s) => ({
        id: s.id,
        codigo: s.codigo,
        nombre: s.nombre,
        almacenes: s.almacenes.map((a) => ({ id: a.id, codigo: a.codigo, nombre: a.nombre })),
      })),
      rol: m.rol,
      permisos: [...(await this.membership.permisos(user.mid))] as Permission[],
    };
  }
}
