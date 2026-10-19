import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../cls';
import { tenantExtension } from './tenant.extension';

const createTenantClient = (base: PrismaClient, getEmpresaId: () => string | null | undefined) =>
  base.$extends(tenantExtension(getEmpresaId));

export type TenantClient = ReturnType<typeof createTenantClient>;

/**
 * - `prisma.<modelo>`: acceso sin filtro (auth, seed, tareas del sistema). Usar con cuidado.
 * - `prisma.tenant.<modelo>`: acceso filtrado por la empresa de la solicitud. Es el que usan los módulos.
 * La conexión es perezosa: no se abre hasta la primera consulta (permite exportar OpenAPI sin BD).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  readonly tenant: TenantClient;

  constructor(private readonly cls: ClsService<AppClsStore>) {
    super({ log: process.env['NODE_ENV'] === 'development' ? ['warn', 'error'] : ['error'] });
    this.tenant = createTenantClient(this, () => this.cls.get('empresaId'));
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
