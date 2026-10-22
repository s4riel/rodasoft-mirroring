import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { ContextResponse, Permission } from '@rodasoft/domain';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CurrentUser } from '../auth/decorators';
import type { JwtUser } from '../auth/jwt.strategy';
import { MembershipService } from './membership.service';

@ApiTags('context')
@ApiBearerAuth()
@Controller('context')
export class ContextController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly membership: MembershipService,
  ) {}

  /** What the ERP needs at startup: user, company (fixed label), allowed branches, role and permissions. */
  @Get()
  async get(@CurrentUser() user: JwtUser): Promise<ContextResponse> {
    const m = await this.prisma.tenant.membership.findUniqueOrThrow({
      where: { id: user.mid },
      include: {
        user: { select: { id: true, email: true, name: true, avatarUrl: true } },
        company: true,
        role: { select: { key: true, name: true } },
        branches: { select: { branchId: true } },
      },
    });
    const branches = await this.prisma.tenant.branch.findMany({
      where: {
        status: 'ACTIVE',
        ...(m.allBranches ? {} : { id: { in: m.branches.map((b) => b.branchId) } }),
      },
      orderBy: { code: 'asc' },
      include: { warehouses: { where: { status: 'ACTIVE' }, orderBy: { code: 'asc' } } },
    });
    return {
      user: m.user,
      company: {
        id: m.company.id,
        slug: m.company.slug,
        legalName: m.company.legalName,
        tradeName: m.company.tradeName,
        nit: m.company.nit,
        brand: m.company.brand,
      },
      branches: branches.map((b) => ({
        id: b.id,
        code: b.code,
        name: b.name,
        warehouses: b.warehouses.map((w) => ({ id: w.id, code: w.code, name: w.name })),
      })),
      role: m.role,
      permissions: [...(await this.membership.permissions(user.mid))] as Permission[],
    };
  }
}
