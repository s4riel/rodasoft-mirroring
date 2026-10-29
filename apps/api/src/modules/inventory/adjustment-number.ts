import { ADJUSTMENT_REF_TYPE, formatAdjustmentNumber } from '@rodasoft/domain';
import type { TenantTransaction } from '../../common/prisma/prisma.service';

/**
 * Serializes the numbering of adjustments per company until the transaction ends, so two adjustments never take the same
 * number and a rolled-back one leaves no gap. Callers that also lock stock take this lock first (the order the quick
 * adjustment uses), so they cannot deadlock with each other. Re-taking it inside the same transaction is a no-op.
 */
export async function lockAdjustmentNumbering(tx: TenantTransaction, companyId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId}::text || ':adjustment'))`;
}

/**
 * Next `AJ-` number of the company. The series is shared by the quick adjustments of the product sheet (HU-INV-16, numbered
 * on their stock movements) and by the adjustment documents (`stock_adjustments`, HU-INV-21 onwards), so the next number is
 * above the highest one used by either.
 */
export async function nextAdjustmentNumber(tx: TenantTransaction, companyId: string): Promise<string> {
  await lockAdjustmentNumbering(tx, companyId);
  const [row] = await tx.$queryRaw<{ last: bigint | null }[]>`
    SELECT max(seq) AS last FROM (
      SELECT substring(ref_number from 4)::bigint AS seq FROM stock_movements
      WHERE company_id = ${companyId}::uuid AND ref_type = ${ADJUSTMENT_REF_TYPE} AND ref_number ~ '^AJ-[0-9]{1,15}$'
      UNION ALL
      SELECT substring(number from 4)::bigint AS seq FROM stock_adjustments
      WHERE company_id = ${companyId}::uuid AND number ~ '^AJ-[0-9]{1,15}$'
    ) AS used`;
  return formatAdjustmentNumber(Number(row?.last ?? 0) + 1);
}
