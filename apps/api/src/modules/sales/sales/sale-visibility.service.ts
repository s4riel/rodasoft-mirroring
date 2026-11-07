import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../../../common/cls';
import { MembershipService } from '../../access/membership.service';

/** Which sales the caller may see (HU-VEN-12). The receipt, the list and the detail all go through it so they cannot drift. */
export interface SaleVisibility {
  /** Narrows a sale query: everything with `sales.history.view-all`, otherwise only the caller's own sales. */
  where: Prisma.SaleWhereInput;
  /** Whether the caller may see every sale of the company. */
  all: boolean;
}

@Injectable()
export class SaleVisibilityService {
  constructor(
    private readonly cls: ClsService<AppClsStore>,
    private readonly membership: MembershipService,
  ) {}

  async resolve(): Promise<SaleVisibility> {
    const membershipId = this.cls.get('membershipId');
    const granted = membershipId ? await this.membership.permissions(membershipId) : new Set<string>();
    if (granted.has('sales.history.view-all')) return { where: {}, all: true };
    // no user in the context sees nothing: an empty id matches no row
    return { where: { createdById: this.cls.get('userId') ?? '' }, all: false };
  }
}
