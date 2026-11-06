import type { Prisma } from '@prisma/client';
import { Decimal, type PaymentStatus } from '@rodasoft/domain';
import type { AuditService } from '../../../common/audit/audit.service';
import type { TenantTransaction } from '../../../common/prisma/prisma.service';
import {
  PaymentProviderError,
  type PaymentProvider,
  type PaymentProviderRegistry,
  type ProviderPaymentMethod,
} from '../payments/payment-provider';

/** The part of a checkout payment row that a provider call needs. */
export interface ProviderPaymentRow {
  method: string;
  providerRef: string | null;
  idempotencyKey: string;
  amount: Prisma.Decimal;
}

/**
 * Calls the provider of a payment (HU-VEN-08 and HU-VEN-10 share it). The mock provider keeps its payments in memory, so after
 * a restart it does not know a payment the database still has: the same charge (same key, same reference) is opened again and
 * the call repeated.
 */
export async function callProvider<T>(
  providers: PaymentProviderRegistry,
  companyId: string,
  row: ProviderPaymentRow,
  call: (provider: PaymentProvider, providerRef: string) => Promise<T>,
): Promise<T> {
  const method = row.method as ProviderPaymentMethod;
  const provider = providers[method];
  try {
    return await call(provider, row.providerRef ?? '');
  } catch (err) {
    if (!(err instanceof PaymentProviderError) || err.code !== 'PAYMENT_NOT_FOUND') throw err;
    const charge = await provider.charge({
      amount: Decimal.of(row.amount.toFixed(2)),
      method,
      idempotencyKey: row.idempotencyKey,
      companyId,
    });
    return call(provider, charge.providerRef);
  }
}

/** Writes the audit row of a payment that changed status. */
export async function logPaymentChange(
  audit: AuditService,
  tx: TenantTransaction,
  action: string,
  id: string,
  from: PaymentStatus,
  to: PaymentStatus,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await audit.log(
    { action, entity: 'PosCheckoutPayment', entityId: id, before: { status: from }, after: { status: to, ...extra } },
    tx as unknown as Prisma.TransactionClient,
  );
}

/** The payment methods that go through an outside provider and take part in "one live provider payment per cart". */
export const PROVIDER_METHODS: ProviderPaymentMethod[] = ['QR', 'CARD'];
