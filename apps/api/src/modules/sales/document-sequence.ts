import { formatSalesDocumentNumber, SALES_DOCUMENT_SERIES, type SalesDocumentSeries } from '@rodasoft/domain';
import type { TenantTransaction } from '../../common/prisma/prisma.service';

/**
 * Next sequence of a document series of the company. The upsert locks the `(company_id, key)` row until the transaction
 * ends, so two sales never take the same number and a rolled-back sale leaves no gap. The counter is never kept in memory.
 */
export async function nextDocumentSequence(tx: TenantTransaction, companyId: string, key: string): Promise<number> {
  const [row] = await tx.$queryRaw<{ last: bigint }[]>`
    INSERT INTO document_sequences (id, company_id, key, last)
    VALUES (gen_random_uuid(), ${companyId}::uuid, ${key}, 1)
    ON CONFLICT (company_id, key) DO UPDATE SET last = document_sequences.last + 1
    RETURNING last`;
  return Number(row.last);
}

/** Next number of a series, ready to print (`V-000231`). Call it inside the transaction that creates the document. */
export async function nextDocumentNumber(tx: TenantTransaction, companyId: string, series: SalesDocumentSeries): Promise<string> {
  const sequence = await nextDocumentSequence(tx, companyId, SALES_DOCUMENT_SERIES[series].key);
  return formatSalesDocumentNumber(series, sequence);
}
