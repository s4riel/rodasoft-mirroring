import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  buildQrPayload,
  Decimal,
  isQrExpired,
  paymentMachine,
  qrExpiresAt,
  type PaymentEvent,
  type PaymentStatus,
  type PosActiveQrResponse,
  type PosQrOutcome,
  type PosQrPayment,
  type PosQrPaymentResponse,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../../common/audit/audit.service';
import type { AppClsStore } from '../../../common/cls';
import { PrismaService, type TenantTransaction } from '../../../common/prisma/prisma.service';
import { SettingsService } from '../../../common/settings/settings.service';
import { CashShiftsService } from '../cash/cash-shifts.service';
import {
  PAYMENT_PROVIDERS,
  PaymentProviderError,
  type PaymentProvider,
  type PaymentProviderRegistry,
} from '../payments/payment-provider';
import type { ConfirmPosQrDto, StartPosQrDto } from './pos-payment.dto';
import { PosPaymentService } from './pos-payment.service';
import { posErrors } from './pos.errors';

type QrRow = Prisma.PosCheckoutPaymentGetPayload<object>;

/** What `confirm` and `cancel` do to a pending payment. */
type Action = { event: PaymentEvent; audit: string };

const CONFIRM: Action = { event: 'confirm', audit: 'sales.payment.qr-confirm' };
const DECLINE: Action = { event: 'decline', audit: 'sales.payment.qr-confirm' };
const CANCEL: Action = { event: 'cancel', audit: 'sales.payment.qr-cancel' };

/** A payment without a deadline never expires. */
function isPastDeadline(row: QrRow): boolean {
  return row.expiresAt !== null && isQrExpired(row.expiresAt, new Date());
}

/**
 * Paying a cart by QR (HU-VEN-08, decision #6). `start` charges the frozen total through the provider and stores the pending
 * payment; the cashier reports the outcome with `confirm` (the mock adapter has no webhook); `complete` (in
 * `PosPaymentService`) only accepts a `CONFIRMED` payment. The database row is the source of truth: the mock provider keeps its
 * state in memory, so a payment it no longer knows is charged again (same key, same reference) before the call is repeated.
 * Every change locks the cart row first, the same order `complete` and `back` use, so they never overtake each other.
 */
@Injectable()
export class PosQrPaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly shifts: CashShiftsService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly payments: PosPaymentService,
    @Inject(PAYMENT_PROVIDERS) private readonly providers: PaymentProviderRegistry,
  ) {}

  /** Opens the QR for the whole total. A repeat with the same key returns the same payment. */
  async start(dto: StartPosQrDto): Promise<PosQrPaymentResponse> {
    await this.shifts.requireOpenShift();
    const cartId = await this.myPayingCartId();
    try {
      const payment = await this.prisma.tenant.$transaction((tx) => this.startInTransaction(tx, cartId, dto));
      return { payment };
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
      // the same key raced with itself (the winner's payment is the answer), or a second QR raced the pending-QR index
      const existing = await this.prisma.tenant.posCheckoutPayment.findFirst({ where: { idempotencyKey: dto.idempotencyKey } });
      if (!existing) throw posErrors.qrAlreadyPending();
      if (existing.checkoutId !== cartId || existing.method !== 'QR') throw posErrors.idempotencyKeyReused();
      return { payment: this.view(existing) };
    }
  }

  /** The state of one of my QR payments; a pending one past its deadline is cancelled first. */
  async get(id: string): Promise<PosQrPaymentResponse> {
    await this.shifts.requireOpenShift();
    const row = await this.findMine(id);
    return { payment: this.view(await this.expireIfDue(row)) };
  }

  /** The QR my PAYING cart waits for or already got confirmed; the ERP asks after a refresh. */
  async current(): Promise<PosActiveQrResponse> {
    await this.shifts.requireOpenShift();
    const row = await this.prisma.tenant.posCheckoutPayment.findFirst({
      where: {
        method: 'QR',
        status: { in: ['PENDING', 'CONFIRMED'] },
        checkout: { cashierId: this.userId(), status: 'PAYING' },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return { payment: null };
    const fresh = await this.expireIfDue(row);
    return { payment: fresh.status === 'PENDING' || fresh.status === 'CONFIRMED' ? this.view(fresh) : null };
  }

  /** The cashier reports the outcome: the customer paid (`APPROVED`) or the payment did not arrive (`DECLINED`). */
  async confirm(id: string, dto: ConfirmPosQrDto): Promise<PosQrPaymentResponse> {
    await this.shifts.requireOpenShift();
    const outcome: PosQrOutcome = dto.outcome;
    return this.settle(id, outcome === 'APPROVED' ? CONFIRM : DECLINE, outcome);
  }

  /** "Cambiar método": drops a pending QR so the cashier can choose another way to pay. */
  async cancel(id: string): Promise<PosQrPaymentResponse> {
    await this.shifts.requireOpenShift();
    return this.settle(id, CANCEL);
  }

  private async settle(id: string, action: Action, outcome?: PosQrOutcome): Promise<PosQrPaymentResponse> {
    const mine = await this.findMine(id);
    const result = await this.prisma.tenant.$transaction(async (tx) => {
      const status = await this.payments.lockStatus(tx, mine.checkoutId);
      const row = await tx.posCheckoutPayment.findFirstOrThrow({ where: { id } });
      const target = paymentMachine.next('PENDING', action.event);
      // repeating the same call is a no-op, even after going back to the cart dropped the QR: it answers with what was left
      if (row.status === target) return { kind: 'done', row } as const;
      if (status !== 'PAYING') throw posErrors.checkoutNotPaying();
      if (row.status !== 'PENDING') throw posErrors.paymentInvalidState(row.status);
      if (isPastDeadline(row)) {
        // committed below: the expiry sticks even though this call is refused
        return { kind: 'expired', row: await this.expire(tx, row) } as const;
      }
      await this.withProvider<unknown>(row, (provider, ref) =>
        action.event === 'cancel' ? provider.cancel(ref) : provider.confirm(ref, outcome === 'APPROVED' ? 'APPROVED' : 'DECLINED'),
      );
      const updated = await tx.posCheckoutPayment.update({ where: { id }, data: { status: target } });
      await this.log(tx, action.audit, updated.id, row.status, target, outcome);
      return { kind: 'done', row: updated } as const;
    });
    if (result.kind === 'expired') throw posErrors.qrExpired();
    return { payment: this.view(result.row) };
  }

  private async startInTransaction(tx: TenantTransaction, cartId: string, dto: StartPosQrDto): Promise<PosQrPayment> {
    const { status, total, priceMoved } = await this.payments.quote(tx, cartId);
    if (status !== 'PAYING') throw posErrors.checkoutNotPaying();

    const sameKey = await tx.posCheckoutPayment.findFirst({ where: { idempotencyKey: dto.idempotencyKey } });
    if (sameKey) {
      if (sameKey.checkoutId !== cartId || sameKey.method !== 'QR') throw posErrors.idempotencyKeyReused();
      return this.view(sameKey);
    }

    const expected = Decimal.of(dto.expectedTotal);
    if (priceMoved || !total.eq(expected)) throw posErrors.totalChanged(expected.toString(), total.toString());

    // a QR that is still waiting blocks a second one; one past its deadline is dropped first
    const open = await tx.posCheckoutPayment.findFirst({
      where: { checkoutId: cartId, method: 'QR', status: { in: ['PENDING', 'CONFIRMED'] } },
    });
    if (open) {
      if (open.status === 'CONFIRMED') throw posErrors.paymentAlreadyConfirmed();
      if (isPastDeadline(open)) await this.expire(tx, open);
      else throw posErrors.qrAlreadyPending();
    }

    const companyId = this.companyId();
    // the provider is idempotent per key, so a retry after a crash charges once; its reference is what the row stores
    const charge = await this.providers.QR.charge({ amount: total, method: 'QR', idempotencyKey: dto.idempotencyKey, companyId });
    if (charge.status !== 'PENDING') throw posErrors.paymentInvalidState(charge.status);
    const timeout = await this.settings.get('sales.qrConfirmTimeoutSeconds', tx);
    const row = await tx.posCheckoutPayment.create({
      data: {
        companyId,
        checkoutId: cartId,
        method: 'QR',
        amount: total.toString(),
        idempotencyKey: dto.idempotencyKey,
        providerRef: charge.providerRef,
        status: 'PENDING',
        qrPayload: buildQrPayload(charge.providerRef, total),
        expiresAt: qrExpiresAt(new Date(), timeout),
      },
    });
    await this.audit.log(
      {
        action: 'sales.payment.qr-start',
        entity: 'PosCheckoutPayment',
        entityId: row.id,
        before: null,
        after: { status: row.status, amount: total.toString(), providerRef: charge.providerRef },
      },
      tx as unknown as Prisma.TransactionClient,
    );
    return this.view(row);
  }

  /** A pending QR past its deadline becomes `CANCELLED`, so a late payment is never accepted by surprise. */
  private async expireIfDue(row: QrRow): Promise<QrRow> {
    if (row.status !== 'PENDING' || !isPastDeadline(row)) return row;
    return this.prisma.tenant.$transaction(async (tx) => {
      await this.payments.lockStatus(tx, row.checkoutId);
      const fresh = await tx.posCheckoutPayment.findFirstOrThrow({ where: { id: row.id } });
      // someone settled it between the read and the lock
      return fresh.status === 'PENDING' ? this.expire(tx, fresh) : fresh;
    });
  }

  private async expire(tx: TenantTransaction, row: QrRow): Promise<QrRow> {
    const next = paymentMachine.next(row.status, 'cancel');
    await this.withProvider(row, (provider, ref) => provider.cancel(ref));
    const updated = await tx.posCheckoutPayment.update({ where: { id: row.id }, data: { status: next } });
    await this.log(tx, 'sales.payment.qr-expire', row.id, row.status, next);
    return updated;
  }

  /**
   * Calls the provider for this payment. The mock keeps its payments in memory, so after a restart it does not know a
   * payment the database still has: the same charge (same key, same reference) is opened again and the call repeated.
   */
  private async withProvider<T>(row: QrRow, call: (provider: PaymentProvider, ref: string) => Promise<T>): Promise<T> {
    const provider = this.providers.QR;
    const ref = row.providerRef ?? '';
    try {
      return await call(provider, ref);
    } catch (err) {
      if (!(err instanceof PaymentProviderError) || err.code !== 'PAYMENT_NOT_FOUND') throw err;
      const charge = await provider.charge({
        amount: Decimal.of(row.amount.toFixed(2)),
        method: 'QR',
        idempotencyKey: row.idempotencyKey,
        companyId: this.companyId(),
      });
      return call(provider, charge.providerRef);
    }
  }

  private async log(
    tx: TenantTransaction,
    action: string,
    id: string,
    from: PaymentStatus,
    to: PaymentStatus,
    outcome?: PosQrOutcome,
  ) {
    await this.audit.log(
      { action, entity: 'PosCheckoutPayment', entityId: id, before: { status: from }, after: { status: to, ...(outcome ? { outcome } : {}) } },
      tx as unknown as Prisma.TransactionClient,
    );
  }

  private view(row: QrRow): PosQrPayment {
    return {
      paymentId: row.id,
      idempotencyKey: row.idempotencyKey,
      amount: row.amount.toFixed(2),
      qrPayload: row.qrPayload ?? '',
      status: row.status,
      expiresAt: (row.expiresAt ?? row.createdAt).toISOString(),
    };
  }

  /** One of my QR payments; another cashier's payment, or a cash one, does not exist for me. */
  private async findMine(id: string): Promise<QrRow> {
    const row = await this.prisma.tenant.posCheckoutPayment.findFirst({
      where: { id, method: 'QR', checkout: { cashierId: this.userId() } },
    });
    if (!row) throw posErrors.paymentNotFound();
    return row;
  }

  private async myPayingCartId(): Promise<string> {
    const cart = await this.prisma.tenant.posCheckout.findFirst({
      where: { cashierId: this.userId(), status: { in: ['OPEN', 'PAYING'] } },
      select: { id: true, status: true },
    });
    if (!cart) throw posErrors.checkoutNotFound();
    if (cart.status !== 'PAYING') throw posErrors.checkoutNotPaying();
    return cart.id;
  }

  private companyId(): string {
    const companyId = this.cls.get('companyId');
    if (!companyId) throw new Error('POS QR payment outside a company context');
    return companyId;
  }

  private userId(): string {
    const userId = this.cls.get('userId');
    if (!userId) throw new Error('POS QR payment outside a user context');
    return userId;
  }
}
