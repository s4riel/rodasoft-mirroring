import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@rodasoft/domain';

export const REQUIRED_PERMISSIONS = 'requiredPermissions';

/** Requires ALL the given permissions. E.g.: @RequirePermissions('sales.cancellations.approve') */
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(REQUIRED_PERMISSIONS, permissions);

export const REQUIRED_ANY_PERMISSIONS = 'requiredAnyPermissions';

/**
 * Requires AT LEAST ONE of the given permissions (HU-VEN-04). Combined with `RequirePermissions` on the same handler or class,
 * both must pass. E.g.: @RequireAnyPermission('inventory.products.view', 'sales.pos.use')
 */
export const RequireAnyPermission = (...permissions: Permission[]) => SetMetadata(REQUIRED_ANY_PERMISSIONS, permissions);
