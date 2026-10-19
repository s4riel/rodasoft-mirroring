import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@rodasoft/domain';

export const REQUIRED_PERMISSIONS = 'requiredPermissions';

/** Exige TODOS los permisos indicados. Ej.: @RequirePermissions('ventas.anulaciones.aprobar') */
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(REQUIRED_PERMISSIONS, permissions);
