import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  Decimal,
  normalizeAuthorizationCode,
  paymentMachine,
  type PaymentEvent,
  type PaymentStatus,
  type PosActiveCardResponse,
  type PosCardPayment,
  type PosCardPaymentResponse,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../../common/audit/audit.service';
import type { AppClsStore } from '../../../common/cls';
import { PrismaService, type TenantTransaction } from '../../../common/prisma/prisma.service';
import { SettingsService } from '../../../common/settings/settings.service';
import { CashShiftsService } from '../cash/cash-shifts.service';
import { PAYMENT_PROVIDERS, type PaymentProviderRegistry } from '../payments/payment-provider';
import type { ConfirmPosCardDto, StartPosCardDto } from './pos-payment.dto';
import { PosPaymentService } from './pos-payment.service';
import { callProvider, logPaymentChange, PROVIDER_METHODS } from './pos-provider-payment';
import { posErrors } from './pos.errors';

type CardRow = Prisma.PosCheckoutPaymentGetPayload<object>;
type TenantDb = TenantTransaction | PrismaService['tenant'];

/** Statuses of a provider payment that still hold the cart: it waits for the terminal or is already paid. */
const LIVE_STATUSES: PaymentStatus[] = ['PENDING', 'CONFIRMED'];

/**
 * Paying a cart by card (HU-VEN-10, decision #8). `start` charges the frozen total through the provider and stores the pending
 * attempt; the cashier reads the terminal and reports the outcome with `confirm` (the mock adapter has no webhook): approved with
 * the voucher's authorization code, or declined with a reason. A decline is final, and the cashier retries with a new attempt (a
 * new `start` with a new key) or goes back. `complete` (in `PosPaymentService`) only accepts a `CONFIRMED` card payment. Every
 * change locks the cart row first, the same order `complete` and `back` use, so they never overtake each other. A card never has
 * a deadline: the terminal answers when the cashier says so.
 */
@Injectable()
export class PosCardPaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly shifts: CashShiftsService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly payments: PosPaymentService,
    @Inject(PAYMENT_PROVIDERS) private readonly providers: PaymentProviderRegistry,
  ) {}

  /** Opens a card attempt for the whole total. A repeat with the same key returns the same payment. */
  async start(dto: StartPosCardDto): Promise<PosCardPaymentResponse> {
    await this.shifts.requireOpenShift();
    if (!(await this.settings.get('sales.cardPaymentEnabled'))) throw posErrors.paymentMethodNotAvailable();
    const cartId = await this.myPayingCartId();
    try {
      const payment = await this.prisma.tenant.$transaction(async (tx) => this.view(tx, await this.startInTransaction(tx, cartId, dto)));
      return { payment };
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
      return { payment: await this.resolveStartRace(cartId, dto.idempotencyKey) };
    }
  }

  /** The same key raced with itself (the winner's payment is the answer), or a second card raced the live-card index. */
  private async resolveStartRace(cartId: string, idempotencyKey: string): Promise<PosCardPayment> {
    const existing = await this.prisma.tenant.posCheckoutPayment.findFirst({ where: { idempotencyKey } });
    if (!existing) throw posErrors.paymentAlreadyPending();
    this.requireOwnCardKey(existing, cartId);
    return this.view(this.prisma.tenant, existing);
  }

  /** A key already used by another cart or by another method cannot start (or answer for) this card attempt. */
  private requireOwnCardKey(row: CardRow, cartId: string): void {
    if (row.checkoutId !== cartId || row.method !== 'CARD') throw posErrors.idempotencyKeyReused();
  }

  /** The state of one of my card attempts. */
  async get(id: string): Promise<PosCardPaymentResponse> {
    await this.shifts.requireOpenShift();
    return { payment: await this.view(this.prisma.tenant, await this.findMine(id)) };
  }

  /** The latest card attempt of my PAYING cart that still matters (waiting, approved or declined); the ERP asks after a refresh. */
  async current(): Promise<PosActiveCardResponse> {
    await this.shifts.requireOpenShift();
    const row = await this.prisma.tenant.posCheckoutPayment.findFirst({
      where: {
        method: 'CARD',
        status: { in: [...LIVE_STATUSES, 'DECLINED'] },
        checkout: { cashierId: this.userId(), status: 'PAYING' },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return { payment: null };
    // a decline is history once the cashier moved on: a QR that waits or was paid owns the screen after a refresh
    if (row.status === 'DECLINED') {
      const live = await this.prisma.tenant.posCheckoutPayment.findFirst({
        where: { checkoutId: row.checkoutId, method: 'QR', status: { in: LIVE_STATUSES } },
        select: { id: true },
      });
      if (live) return { payment: null };
    }
    return { payment: await this.view(this.prisma.tenant, row) };
  }

  /** The cashier reports what the terminal said: approved with the voucher's code, or declined with the reason. */
  async confirm(id: string, dto: ConfirmPosCardDto): Promise<PosCardPaymentResponse> {
    await this.shifts.requireOpenShift();
    if (dto.outcome === 'APPROVED') {
      const code = normalizeAuthorizationCode(dto.authorizationCode ?? '');
      if (!code.ok) throw posErrors.invalidAuthorizationCode();
      return this.settle(id, 'confirm', { reference: code.code }, { authorizationCode: code.code });
    }
    if (!dto.reason) throw posErrors.invalidPayment('reason');
    return this.settle(id, 'decline', { declineReason: dto.reason }, { reason: dto.reason });
  }

  /** "Cambiar forma de pago" while the terminal is still waiting: drops the pending attempt. */
  async cancel(id: string): Promise<PosCardPaymentResponse> {
    await this.shifts.requireOpenShift();
    return this.settle(id, 'cancel', {}, {});
  }

  private async settle(
    id: string,
    event: PaymentEvent,
    data: Prisma.PosCheckoutPaymentUncheckedUpdateInput,
    audited: Record<string, unknown>,
  ): Promise<PosCardPaymentResponse> {
    const mine = await this.findMine(id);
    const payment = await this.prisma.tenant.$transaction(async (tx) => {
      const status = await this.payments.lockStatus(tx, mine.checkoutId);
      const row = await tx.posCheckoutPayment.findFirstOrThrow({ where: { id } });
      const target = paymentMachine.next('PENDING', event);
      // repeating the same call is a no-op, even after going back to the cart dropped the attempt: it answers with what was left
      if (row.status === target) {
        // ... but only with the same report: another code or reason is a different answer, not a repeat
        const same = Object.entries(data).every(([field, value]) => (row as Record<string, unknown>)[field] === value);
        if (!same) throw posErrors.paymentInvalidState(row.status);
        return this.view(tx, row);
      }
      if (status !== 'PAYING') throw posErrors.checkoutNotPaying();
      if (row.status !== 'PENDING') throw posErrors.paymentInvalidState(row.status);
      await this.tellProvider(row, event);
      const updated = await tx.posCheckoutPayment.update({ where: { id }, data: { ...data, status: target } });
      const outcome = event === 'cancel' ? {} : { outcome: event === 'confirm' ? 'APPROVED' : 'DECLINED' };
      await logPaymentChange(this.audit, tx, `sales.payment.card-${event === 'cancel' ? 'cancel' : 'confirm'}`, id, row.status, target, {
        ...outcome,
        ...audited,
      });
      return this.view(tx, updated);
    });
    return { payment };
  }

  private async tellProvider(row: CardRow, event: PaymentEvent): Promise<void> {
    await callProvider<unknown>(this.providers, this.companyId(), row, (provider, ref) =>
      event === 'cancel' ? provider.cancel(ref) : provider.confirm(ref, event === 'confirm' ? 'APPROVED' : 'DECLINED'),
    );
  }

  private async startInTransaction(tx: TenantTransaction, cartId: string, dto: StartPosCardDto): Promise<CardRow> {
    const { status, total, priceMoved } = await this.payments.quote(tx, cartId);
    if (status !== 'PAYING') throw posErrors.checkoutNotPaying();

    const sameKey = await tx.posCheckoutPayment.findFirst({ where: { idempotencyKey: dto.idempotencyKey } });
    if (sameKey) {
      this.requireOwnCardKey(sameKey, cartId);
      return sameKey;
    }

    const expected = Decimal.of(dto.expectedTotal);
    if (priceMoved || !total.eq(expected)) throw posErrors.totalChanged(expected.toString(), total.toString());

    // a sale is paid by one provider method at a time: a waiting or paid card, or QR, blocks a new attempt. A declined or
    // cancelled attempt does not, so the cashier can retry.
    const live = await tx.posCheckoutPayment.findFirst({
      where: {
        checkoutId: cartId,
        method: { in: PROVIDER_METHODS },
        status: { in: LIVE_STATUSES },
        // a QR past its deadline is dead even if nobody has cancelled it yet (the QR service does that on its own paths)
        NOT: { method: 'QR', status: 'PENDING', expiresAt: { lte: new Date() } },
      },
    });
    if (live) throw live.status === 'CONFIRMED' ? posErrors.paymentAlreadyConfirmed() : posErrors.paymentAlreadyPending();

    const companyId = this.companyId();
    // the provider is idempotent per key, so a retry after a crash charges once; its reference is what the row stores
    const charge = await this.providers.CARD.charge({ amount: total, method: 'CARD', idempotencyKey: dto.idempotencyKey, companyId });
    if (charge.status !== 'PENDING') throw posErrors.paymentInvalidState(charge.status);
    const row = await tx.posCheckoutPayment.create({
      data: {
        companyId,
        checkoutId: cartId,
        method: 'CARD',
        amount: total.toString(),
        idempotencyKey: dto.idempotencyKey,
        providerRef: charge.providerRef,
        status: 'PENDING',
      },
    });
    await this.audit.log(
      {
        action: 'sales.payment.card-start',
        entity: 'PosCheckoutPayment',
        entityId: row.id,
        before: null,
        after: { status: row.status, amount: total.toString(), providerRef: charge.providerRef },
      },
      tx as unknown as Prisma.TransactionClient,
    );
    return row;
  }

  /** The attempt as the screen needs it; `attempt` counts the checkout's card attempts up to this one, cancelled ones aside. */
  private async view(db: TenantDb, row: CardRow): Promise<PosCardPayment> {
    const attempt = await db.posCheckoutPayment.count({
      where: { checkoutId: row.checkoutId, method: 'CARD', status: { not: 'CANCELLED' }, createdAt: { lte: row.createdAt } },
    });
    return {
      paymentId: row.id,
      idempotencyKey: row.idempotencyKey,
      amount: row.amount.toFixed(2),
      status: row.status,
      attempt: Math.max(1, attempt),
      authorizationCode: row.status === 'CONFIRMED' ? row.reference : null,
      declineReason: row.status === 'DECLINED' ? row.declineReason : null,
    };
  }

  /** One of my card attempts; another cashier's payment, or a QR or cash one, does not exist for me. */
  private async findMine(id: string): Promise<CardRow> {
    const row = await this.prisma.tenant.posCheckoutPayment.findFirst({
      where: { id, method: 'CARD', checkout: { cashierId: this.userId() } },
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
    if (!companyId) throw new Error('POS card payment outside a company context');
    return companyId;
  }

  private userId(): string {
    const userId = this.cls.get('userId');
    if (!userId) throw new Error('POS card payment outside a user context');
    return userId;
  }
}
