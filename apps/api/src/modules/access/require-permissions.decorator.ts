import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@rodasoft/domain';

export const REQUIRED_PERMISSIONS = 'requiredPermissions';

/** Requires ALL the given permissions. E.g.: @RequirePermissions('sales.cancellations.approve') */
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(REQUIRED_PERMISSIONS, permissions);
