import { Prisma } from '@prisma/client';

/**
 * Modelos con columna empresa_id. Toda consulta a estos modelos hecha con `prisma.tenant`
 * se filtra por la empresa del contexto y las altas reciben empresaId automáticamente.
 * ⚠ Al crear un modelo de negocio nuevo, agregarlo aquí (tenant.extension.spec.ts falla si se olvida).
 * ⚠ En altas, usar claves foráneas planas (`sucursalId: …`), no `sucursal: { connect }`:
 *   Prisma no permite mezclar ambos estilos y la extensión agrega `empresaId` plano.
 */
export const TENANT_MODELS = new Set<Prisma.ModelName>([
  'Sucursal',
  'Almacen',
  'Membresia',
  'Rol',
  'PuntoVentaSiat',
]);

/** Modelos con empresa_id que se consultan SIN filtro a propósito (sistema / autenticación). */
export const UNSCOPED_MODELS = new Set<string>(['AuditLog', 'OutboxEvent', 'RefreshToken', 'SiatConfiguracion', 'Empresa']);

const WHERE_OPS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);

export class MissingTenantError extends Error {
  constructor(model: string) {
    super(`Consulta a ${model} sin empresa en el contexto (usar prisma.tenant dentro de una solicitud autenticada)`);
  }
}

export function tenantExtension(getEmpresaId: () => string | null | undefined) {
  return Prisma.defineExtension({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_MODELS.has(model as Prisma.ModelName)) return query(args);
          const empresaId = getEmpresaId();
          if (!empresaId) throw new MissingTenantError(model);
          const a = (args ?? {}) as Record<string, any>;
          if (WHERE_OPS.has(operation)) a.where = { ...(a.where ?? {}), empresaId };
          if (operation === 'create') a.data = { ...(a.data ?? {}), empresaId };
          if (operation === 'createMany' || operation === 'createManyAndReturn') {
            const rows = Array.isArray(a.data) ? a.data : [a.data];
            a.data = rows.map((r: object) => ({ ...r, empresaId }));
          }
          if (operation === 'upsert') a.create = { ...(a.create ?? {}), empresaId };
          return query(a);
        },
      },
    },
  });
}
