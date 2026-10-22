import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../cls';
import { tenantExtension } from './tenant.extension';

const createTenantClient = (base: PrismaClient, getCompanyId: () => string | null | undefined) =>
  base.$extends(tenantExtension(getCompanyId));

export type TenantClient = ReturnType<typeof createTenantClient>;

/**
 * - `prisma.<model>`: unfiltered access (auth, seed, system tasks). Use with care.
 * - `prisma.tenant.<model>`: access filtered by the request's company. This is what modules use.
 * The connection is lazy: it is not opened until the first query (allows exporting OpenAPI without a DB).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  readonly tenant: TenantClient;

  constructor(private readonly cls: ClsService<AppClsStore>) {
    super({ log: process.env['NODE_ENV'] === 'development' ? ['warn', 'error'] : ['error'] });
    this.tenant = createTenantClient(this, () => this.cls.get('companyId'));
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
