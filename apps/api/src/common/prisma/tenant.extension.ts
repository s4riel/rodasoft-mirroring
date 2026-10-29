import { Prisma } from '@prisma/client';

/**
 * Models with a company_id column. Every query on these models made through `prisma.tenant`
 * is filtered by the context's company and creates receive companyId automatically.
 * WARNING: when adding a new business model, add it here (tenant.extension.spec.ts fails if forgotten).
 * WARNING: on creates, use flat foreign keys (`branchId: ...`), not `branch: { connect }`:
 *   Prisma does not allow mixing both styles and the extension adds a flat `companyId`.
 */
export const TENANT_MODELS = new Set<Prisma.ModelName>([
  'Branch',
  'Warehouse',
  'Membership',
  'Role',
  'SiatPointOfSale',
  'Country',
  'Brand',
  'Category',
  'AttributeDefinition',
  'Product',
  'ProductDimension',
  'StockLevel',
  'StockThreshold',
  'StockMovement',
  'Equivalence',
  'Transfer',
  'TransferItem',
  'TransferReceipt',
  'TransferReceiptItem',
  'StockAdjustment',
  'StockAdjustmentItem',
  'CompanySetting',
]);

/** Models with company_id that are intentionally queried WITHOUT a filter (system / authentication). */
export const UNSCOPED_MODELS = new Set<string>([
  'AuditLog',
  'OutboxEvent',
  'RefreshToken',
  'SiatSettings',
  'Company',
]);

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
    super(
      `Query on ${model} without a company in context (use prisma.tenant inside an authenticated request)`,
    );
  }
}

/** Hook run on every query; exported separately so it can be tested without a database. */
export function tenantHook(getCompanyId: () => string | null | undefined) {
  return async ({
    model,
    operation,
    args,
    query,
  }: {
    model?: string;
    operation: string;
    args: any;
    query: (a: any) => any;
  }) => {
    if (!model || !TENANT_MODELS.has(model as Prisma.ModelName)) return query(args);
    const companyId = getCompanyId();
    if (!companyId) throw new MissingTenantError(model);
    const a = (args ?? {}) as Record<string, any>;
    if (WHERE_OPS.has(operation)) a.where = { ...(a.where ?? {}), companyId };
    if (operation === 'create') a.data = { ...(a.data ?? {}), companyId };
    if (operation === 'createMany' || operation === 'createManyAndReturn') {
      const rows = Array.isArray(a.data) ? a.data : [a.data];
      a.data = rows.map((r: object) => ({ ...r, companyId }));
    }
    if (operation === 'upsert') a.create = { ...(a.create ?? {}), companyId };
    return query(a);
  };
}

export function tenantExtension(getCompanyId: () => string | null | undefined) {
  return Prisma.defineExtension({
    name: 'tenant-scope',
    query: { $allModels: { $allOperations: tenantHook(getCompanyId) } },
  });
}
