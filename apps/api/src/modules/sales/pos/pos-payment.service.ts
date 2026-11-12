import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  availableQuantity,
  canCompleteWithPayments,
  cartTotals,
  creditDueDate,
  creditEligibility,
  Decimal,
  InvalidTransitionError,
  MONEY_SCALE,
  laPazToday,
  lineTotal,
  paymentMachine,
  paymentsCover,
  posCheckoutMachine,
  SALE_REF_TYPE,
  suggestCashAmounts,
  validateCashTendered,
  validateCreditTerm,
  validateMixedPayments,
  validateOpeningFloat,
  type CompletedSale,
  type CompletePosCheckoutResponse,
  type CreditEligibility,
  type CurrentCashShift,
  type PosCheckoutResponse,
  type PosCreditInfo,
  type PosPayResponse,
  type PosPriceChange,
  type PosCheckoutEvent,
  type PosCheckoutStatus,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../../common/audit/audit.service';
import type { AppClsStore } from '../../../common/cls';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { PrismaService, type TenantTransaction } from '../../../common/prisma/prisma.service';
import { SettingsService } from '../../../common/settings/settings.service';
import { StockMovementService } from '../../inventory/stock-movement.service';
import { cashErrors } from '../cash/cash.errors';
import { CashShiftsService } from '../cash/cash-shifts.service';
import { nextDocumentNumber } from '../document-sequence';
import { PAYMENT_PROVIDERS, type PaymentProviderRegistry, type ProviderPaymentMethod } from '../payments/payment-provider';
import type { CompletePosCheckoutDto } from './pos-payment.dto';
import { PosCheckoutService } from './pos-checkout.service';
import { invoiceDataOf } from './pos-invoice-data';
import { posErrors } from './pos.errors';

/** The cart as the payment needs it: lines with the product's current price and status, and the customer. */
const CART_FOR_PAYMENT = {
  customer: true,
  items: {
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: {
      product: { select: { id: true, status: true, salePrice: true, manufacturerCode: true, name: true } },
    },
  },
} satisfies Prisma.PosCheckoutInclude;

type CartForPayment = Prisma.PosCheckoutGetPayload<{ include: typeof CART_FOR_PAYMENT }>;
type TenantDb = TenantTransaction | PrismaService['tenant'];

const MY_CART_STATUSES: PosCheckoutStatus[] = ['OPEN', 'PAYING'];

/** One line of what the customer paid with, as `complete` reads it from the request. */
type Tender =
  | { method: 'CASH'; received: string }
  | { method: 'QR'; paymentId: string }
  | { method: 'CARD'; paymentId: string }
  | { method: 'CREDIT'; termDays: number };

/** A confirmed QR or card payment of this cart, found and checked. `reference` is the card's authorization code. */
type ProviderLine = { amount: Decimal; providerRef: string; paymentId: string; reference: string | null };

/**
 * The payments once checked against the total (HU-VEN-07, 08 and 09): the cash line with what it must cover (`due`) and what
 * the customer handed over; the QR line with its provider reference; and the whole sale's received amount and change.
 */
interface Settlement {
  method: 'CASH' | 'QR' | 'CARD' | 'MIXED' | 'CREDIT';
  cash: { received: Decimal; due: Decimal } | null;
  qr: ProviderLine | null;
  /** A card is always the only payment of the sale (HU-VEN-10). */
  card: ProviderLine | null;
  /** The whole sale on credit (HU-VEN-34): always alone; nothing is collected now, the balance waits for accounts receivable. */
  credit: { amount: Decimal; termDays: number; dueDate: string } | null;
  /** Everything the customer handed over, change included. */
  received: Decimal;
  change: Decimal;
}

/**
 * Paying the cart in cash and completing the sale (HU-VEN-07 and HU-VEN-11). `pay` freezes the total for the payment screen
 * (`OPEN → PAYING`), `back` returns to the cart, and `complete` writes the whole sale in ONE transaction: the `Sale` and its
 * lines and payment, the stock movements, the cash movement, the `PENDING` invoice record, the audit row and the outbox event.
 * Any failure rolls everything back, so a sale is never half written. Totals are always recomputed here: the total the ERP
 * shows is only a preview.
 */
@Injectable()
export class PosPaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly shifts: CashShiftsService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly stock: StockMovementService,
    private readonly checkout: PosCheckoutService,
    @Inject(PAYMENT_PROVIDERS) private readonly providers: PaymentProviderRegistry,
  ) {}

  /**
   * The cart as the payment screen sees it, under the cart row lock: its status, the current total and whether a line's price
   * moved since `pay`. The QR payment (HU-VEN-08) starts from this, so it charges exactly what `complete` will ask for.
   */
  async quote(tx: TenantTransaction, cartId: string): Promise<{ status: PosCheckoutStatus; total: Decimal; priceMoved: boolean }> {
    const status = await this.lockStatus(tx, cartId);
    const cart = await this.loadCart(tx, cartId);
    const totals = await this.totalsOf(tx, cart);
    return { status, total: totals.total, priceMoved: this.priceMoved(cart) };
  }

  /**
   * `OPEN → PAYING`. Checks every line's price against the product's current price first: if one changed, the lines are
   * updated, the cart stays `OPEN` and the call answers `CHECKOUT_PRICES_CHANGED`, so the cashier never charges an amount
   * they did not see.
   */
  async pay(): Promise<PosPayResponse> {
    await this.shifts.requireOpenShift();
    const mine = await this.myCart();
    const outcome = await this.prisma.tenant.$transaction(async (tx) => {
      const status = await this.lockStatus(tx, mine.id);
      const next = this.next(status, 'pay');
      const cart = await this.loadCart(tx, mine.id);
      if (cart.items.length === 0) throw posErrors.checkoutEmpty();
      for (const item of cart.items) if (item.product.status !== 'ACTIVE') throw posErrors.productInactive();
      invoiceDataOf(cart.customer);

      const changed: PosPriceChange[] = [];
      for (const item of cart.items) {
        const newPrice = item.product.salePrice.toFixed(2);
        const oldPrice = item.unitPrice.toFixed(2);
        if (newPrice === oldPrice) continue;
        await tx.posCheckoutItem.update({ where: { id: item.id }, data: { unitPrice: newPrice } });
        changed.push({ lineId: item.id, code: item.product.manufacturerCode, oldPrice, newPrice });
      }
      // the updated prices are kept: the transaction commits and the error is raised after it
      if (changed.length > 0) return { kind: 'changed', changed } as const;

      const totals = await this.totalsOf(tx, cart);
      await tx.posCheckout.update({ where: { id: cart.id }, data: { status: next } });
      await this.audit.log(
        {
          action: 'sales.checkout.pay',
          entity: 'PosCheckout',
          entityId: cart.id,
          before: { status },
          after: { status: next, total: totals.total.toString() },
        },
        tx as unknown as Prisma.TransactionClient,
      );
      const response: PosPayResponse = {
        total: totals.total.toString(),
        suggestedAmounts: suggestCashAmounts(totals.total).map((amount) => amount.toString()),
        allowMixed: await this.settings.get('sales.allowMixedPayment', tx),
        cardEnabled: await this.settings.get('sales.cardPaymentEnabled', tx),
        credit: await this.creditInfo(tx, cart.customer),
      };
      return { kind: 'paying', response } as const;
    });
    if (outcome.kind === 'changed') throw posErrors.pricesChanged(outcome.changed);
    return outcome.response;
  }

  /** `PAYING → OPEN`: the cashier cancels the payment screen and goes back to the cart. No payment exists yet. */
  async back(): Promise<PosCheckoutResponse> {
    await this.shifts.requireOpenShift();
    const mine = await this.myCart();
    await this.prisma.tenant.$transaction(async (tx) => {
      const status = await this.lockStatus(tx, mine.id);
      if (status !== 'PAYING') throw posErrors.checkoutNotPaying();
      const next = this.next(status, 'back');
      await this.dropProviderPayments(tx, mine.id, ['QR', 'CARD']);
      await tx.posCheckout.update({ where: { id: mine.id }, data: { status: next } });
      await this.audit.log(
        {
          action: 'sales.checkout.back',
          entity: 'PosCheckout',
          entityId: mine.id,
          before: { status },
          after: { status: next },
        },
        tx as unknown as Prisma.TransactionClient,
      );
    });
    return this.checkout.current();
  }

  /** Completes the sale: see the class comment. A repeat with the same `idempotencyKey` returns the stored sale. */
  async complete(dto: CompletePosCheckoutDto): Promise<CompletePosCheckoutResponse> {
    // cash, QR or both (HU-VEN-09); a card or a credit alone; transfer arrives with its own story
    const tenders = this.parseTenders(dto.payments);

    // a retry of a sale that already committed returns it, even if the shift was closed in between
    const done = await this.findCompleted(this.prisma.tenant, dto.idempotencyKey, dto.expectedTotal);
    if (done) return done;
    const shift = await this.shifts.requireOpenShift();

    const mine = await this.prisma.tenant.posCheckout.findFirst({
      where: { cashierId: this.userId(), status: 'PAYING' },
      select: { id: true },
    });
    if (!mine) {
      // nothing is waiting for payment: a cart that is still OPEN was never sent to pay; without any cart there is no sale
      const open = await this.prisma.tenant.posCheckout.findFirst({
        where: { cashierId: this.userId(), status: 'OPEN' },
        select: { id: true },
      });
      throw open ? posErrors.checkoutNotPaying() : posErrors.checkoutNotFound();
    }

    try {
      return await this.completeInTransaction(dto, tenders, shift, mine.id);
    } catch (err) {
      // two carts of the company sent the same key: the second one loses, with a coded error instead of a 500
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
        throw posErrors.idempotencyKeyReused();
      throw err;
    }
  }

  /** The request lines as tenders: cash and QR (alone or mixed), or a card or a credit alone; one line per method. */
  private parseTenders(payments: CompletePosCheckoutDto['payments']): Tender[] {
    const tenders: Tender[] = [];
    for (const payment of payments) {
      if (payment.method !== 'CASH' && payment.method !== 'QR' && payment.method !== 'CARD' && payment.method !== 'CREDIT')
        throw posErrors.paymentMethodNotAvailable();
      if (tenders.some((tender) => tender.method === payment.method)) throw posErrors.paymentDuplicateMethod();
      if (payment.method === 'CREDIT') {
        if (!validateCreditTerm(payment.termDays)) throw posErrors.creditTermInvalid();
        tenders.push({ method: 'CREDIT', termDays: payment.termDays });
      } else if (payment.method === 'CASH') {
        if (typeof payment.received !== 'string') throw posErrors.invalidPayment('received');
        tenders.push({ method: 'CASH', received: payment.received });
      } else {
        if (typeof payment.paymentId !== 'string') throw posErrors.invalidPayment('paymentId');
        tenders.push({ method: payment.method, paymentId: payment.paymentId });
      }
    }
    // a card does not mix with another method (HU-VEN-10)
    if (tenders.length > 1 && tenders.some((tender) => tender.method === 'CARD')) throw posErrors.paymentMethodNotAvailable();
    // nor does a credit: the whole sale is charged to the customer's account (HU-VEN-34)
    if (tenders.length > 1 && tenders.some((tender) => tender.method === 'CREDIT')) throw posErrors.paymentMethodNotAvailable();
    return tenders;
  }

  private completeInTransaction(
    dto: CompletePosCheckoutDto,
    tenders: Tender[],
    shift: CurrentCashShift,
    cartId: string,
  ): Promise<CompletePosCheckoutResponse> {
    return this.prisma.tenant.$transaction(async (tx) => {
      // a shift that closed since `requireOpenShift` cannot take the cash of this sale (HU-VEN-23 will close shifts)
      await this.lockOpenShift(tx, shift.id);
      const status = await this.lockStatus(tx, cartId);
      if (status === 'COMPLETED') {
        // a concurrent call with the same key finished first
        const stored = await this.findCompleted(tx, dto.idempotencyKey, dto.expectedTotal);
        if (stored) return stored;
        throw posErrors.checkoutNotPaying();
      }
      const next = this.next(status, 'complete');

      const cart = await this.loadCart(tx, cartId);
      if (cart.items.length === 0) throw posErrors.checkoutEmpty();
      for (const item of cart.items) if (item.product.status !== 'ACTIVE') throw posErrors.productInactive();
      const invoice = invoiceDataOf(cart.customer);

      // a price changed after `pay`: the cashier must see the new total, so the sale is refused and `pay` is repeated
      const totals = await this.totalsOf(tx, cart);
      const expected = Decimal.of(dto.expectedTotal);
      if (this.priceMoved(cart) || !totals.total.eq(expected))
        throw posErrors.totalChanged(expected.toString(), totals.total.toString());

      const creditTender = tenders.find((tender) => tender.method === 'CREDIT');
      const cashTender = tenders.find((tender) => tender.method === 'CASH');
      const qrTender = tenders.find((tender) => tender.method === 'QR');
      const cardTender = tenders.find((tender) => tender.method === 'CARD');
      // a payment of another provider method that is still waiting is dropped, and one already paid blocks the sale: the
      // customer paid it (a stale client or a second tab), so the cashier cannot take the money again another way
      if (creditTender) await this.assertNoProviderPayment(tx, cart.id);
      else if (cashTender && !qrTender) await this.dropProviderPayments(tx, cart.id, ['QR', 'CARD']);
      else if (qrTender) await this.dropProviderPayments(tx, cart.id, ['CARD']);
      else if (cardTender) await this.dropProviderPayments(tx, cart.id, ['QR']);
      const qr = qrTender ? await this.loadProviderPayment(tx, cart.id, 'QR', qrTender.paymentId, dto.idempotencyKey) : null;
      const card = cardTender ? await this.loadProviderPayment(tx, cart.id, 'CARD', cardTender.paymentId, dto.idempotencyKey) : null;
      const settled = creditTender
        ? this.settleCredit(totals.total, creditTender.termDays, cart.customer)
        : card
          ? this.settleCard(totals.total, card)
          : await this.settle(tx, totals.total, cashTender?.received ?? null, qr);

      const companyId = this.companyId();
      const userId = this.userId();
      const number = await nextDocumentNumber(tx, companyId, 'sale');
      const afterDiscount = totals.subtotal.sub(totals.discount);
      const customer = cart.customer;

      const sale = await tx.sale.create({
        data: {
          companyId,
          number,
          checkoutId: cart.id,
          customerId: cart.customerId,
          branchId: shift.branch.id,
          warehouseId: shift.warehouse.id,
          shiftId: shift.id,
          status: 'COMPLETED',
          subtotal: totals.subtotal.toString(),
          // the customer's discount is copied, so a later change of the customer does not alter the sale
          discountType: customer?.discountType ?? 'NONE',
          discountValue: customer?.discountValue.toFixed(2) ?? '0.00',
          discountAmount: totals.discount.toString(),
          roundingAmount: totals.total.sub(afterDiscount).toString(),
          total: totals.total.toString(),
          createdById: userId,
          items: {
            create: cart.items.map((item) => ({
              companyId,
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice.toFixed(2),
              lineTotal: lineTotal(item.unitPrice.toFixed(2), item.quantity).toString(),
              sortOrder: item.sortOrder,
            })),
          },
        },
        select: { id: true, createdAt: true },
      });

      // stock out, products in id order so two sales with the same products never lock them in opposite order
      const byProduct = [...cart.items].sort((a, b) =>
        a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0,
      );
      for (const item of byProduct)
        await this.takeStock(tx, shift, item.productId, item.quantity, sale.id, number);

      const change = settled.change;
      if (settled.cash) {
        const due = settled.cash.due.toString();
        await tx.salePayment.create({
          data: { companyId, saleId: sale.id, method: 'CASH', amount: due, change: change.toString() },
        });
        await tx.posCheckoutPayment.create({
          data: {
            companyId,
            checkoutId: cart.id,
            method: 'CASH',
            amount: due,
            change: change.toString(),
            // a QR row of the same cart already holds the sale's key, and keys are unique per company
            idempotencyKey: settled.qr ? `${dto.idempotencyKey}:cash` : dto.idempotencyKey,
            status: 'CONFIRMED',
          },
        });
        // the register keeps the cash of the sale net of the change given back
        await tx.cashMovement.create({
          data: {
            companyId,
            shiftId: shift.id,
            type: 'SALE_PAYMENT',
            amount: due,
            reason: `Venta ${number}`,
            refType: SALE_REF_TYPE,
            refId: sale.id,
            userId,
          },
        });
      }
      if (settled.credit) {
        // nothing is collected: the balance is the payment itself, with its due date, until accounts receivable exists (HU-CON-03)
        const dueDate = new Date(`${settled.credit.dueDate}T00:00:00Z`);
        await tx.salePayment.create({
          data: { companyId, saleId: sale.id, method: 'CREDIT', amount: settled.credit.amount.toString(), change: '0.00', dueDate },
        });
        await tx.posCheckoutPayment.create({
          data: {
            companyId,
            checkoutId: cart.id,
            method: 'CREDIT',
            amount: settled.credit.amount.toString(),
            change: '0.00',
            idempotencyKey: dto.idempotencyKey,
            status: 'CONFIRMED',
            dueDate,
          },
        });
      }
      if (settled.card) {
        // the card payment row already exists and is CONFIRMED; the money goes to the bank, so the register gets nothing
        await tx.salePayment.create({
          data: {
            companyId,
            saleId: sale.id,
            method: 'CARD',
            amount: settled.card.amount.toString(),
            change: '0.00',
            reference: settled.card.reference ?? settled.card.providerRef,
            providerStatus: 'CONFIRMED',
          },
        });
      }
      if (settled.qr) {
        // the QR payment row already exists and is CONFIRMED; the money goes to the provider, so the register gets nothing
        await tx.salePayment.create({
          data: {
            companyId,
            saleId: sale.id,
            method: 'QR',
            amount: settled.qr.amount.toString(),
            change: '0.00',
            reference: settled.qr.providerRef,
            providerStatus: 'CONFIRMED',
          },
        });
      }
      // no SIAT call here: the invoice is a PENDING record that the SIAT epic issues (HU-FAC)
      await tx.invoice.create({
        data: {
          companyId,
          saleId: sale.id,
          status: 'PENDING',
          total: totals.total.toString(),
          customerTaxName: invoice.name,
          customerDocumentType: invoice.documentType,
          customerDocumentNumber: invoice.documentNumber,
        },
      });
      await tx.posCheckout.update({ where: { id: cart.id }, data: { status: next } });

      await this.audit.log(
        {
          action: 'sales.sale.complete',
          entity: 'Sale',
          entityId: sale.id,
          before: { checkoutStatus: status },
          after: {
            number,
            method: settled.method,
            payments: [
              ...(settled.cash ? [{ method: 'CASH', amount: settled.cash.due.toString() }] : []),
              ...(settled.qr ? [{ method: 'QR', amount: settled.qr.amount.toString() }] : []),
              ...(settled.card ? [{ method: 'CARD', amount: settled.card.amount.toString() }] : []),
              ...(settled.credit
                ? [{ method: 'CREDIT', amount: settled.credit.amount.toString(), termDays: settled.credit.termDays, dueDate: settled.credit.dueDate }]
                : []),
            ],
            total: totals.total.toString(),
            received: settled.received.toString(),
            change: change.toString(),
            checkoutStatus: next,
          },
        },
        tx as unknown as Prisma.TransactionClient,
      );
      await this.outbox.publish(
        'sale.completed',
        {
          saleId: sale.id,
          number,
          refType: SALE_REF_TYPE,
          total: totals.total.toString(),
          shiftId: shift.id,
          branchId: shift.branch.id,
          // accounts receivable (HU-CON-03) takes the balance from here
          ...(settled.credit
            ? { credit: { customerId: cart.customerId, amount: settled.credit.amount.toString(), dueDate: settled.credit.dueDate } }
            : {}),
        },
        { tx, idempotencyKey: `sale-completed:${sale.id}` },
      );

      const completed: CompletedSale = {
        saleId: sale.id,
        number,
        createdAt: sale.createdAt.toISOString(),
        total: totals.total.toString(),
        received: settled.received.toString(),
        change: change.toString(),
        customerName: invoice.name,
        invoiceStatus: 'PENDING',
        customerEmail: customer?.email ?? null,
        dueDate: settled.credit?.dueDate ?? null,
      };
      return { sale: completed };
    });
  }

  /** A line whose price moved since `pay`: the cashier must see the new total first. */
  private priceMoved(cart: CartForPayment): boolean {
    return cart.items.some((item) => item.product.salePrice.toFixed(2) !== item.unitPrice.toFixed(2));
  }

  /**
   * Checks the payments against the total. Cash alone must cover it (the rest is the change); a QR alone must charge exactly
   * the total; a QR and cash together are a mixed payment (decision #7): the QR is an exact part, and the cash must cover
   * what it leaves and may exceed it by the change.
   */
  private async settle(
    tx: TenantTransaction,
    total: Decimal,
    cashText: string | null,
    qr: ProviderLine | null,
  ): Promise<Settlement> {
    if (cashText === null && qr) {
      // the QR charged another amount than the total: a part of a mix that nothing completes, or a total that moved
      if (qr.amount.cmp(total) < 0) throw posErrors.paymentNotCovered(total.toString());
      if (qr.amount.cmp(total) > 0) throw posErrors.totalChanged(qr.amount.toString(), total.toString());
      const cover = paymentsCover(total, [{ method: 'QR', amount: total }]);
      if (!cover.ok) throw posErrors.paymentNotCovered(total.toString());
      return { method: 'QR', cash: null, qr, card: null, credit: null, received: total, change: cover.change };
    }
    if (cashText !== null && !qr) return this.settleCash(total, cashText);
    if (cashText === null || !qr) throw posErrors.paymentMethodNotAvailable();

    const parsed = validateOpeningFloat(cashText.replace(/,$/, ''));
    if (!parsed.ok) throw parsed.error === 'TOO_LARGE' ? posErrors.amountTooLarge() : posErrors.invalidAmount();
    const allowMixed = await this.settings.get('sales.allowMixedPayment', tx);
    const mix = validateMixedPayments(
      total,
      [
        { method: 'CASH', amount: parsed.value },
        { method: 'QR', amount: qr.amount },
      ],
      allowMixed,
    );
    if (!mix.ok) {
      if (mix.error === 'MIXED_PAYMENT_DISABLED') throw posErrors.mixedPaymentDisabled();
      if (mix.error === 'PAYMENT_INVALID_AMOUNT') throw posErrors.paymentInvalidAmount();
      if (mix.error === 'PAYMENT_DUPLICATE_METHOD') throw posErrors.paymentDuplicateMethod();
      if (mix.error === 'PAYMENT_METHOD_NOT_AVAILABLE') throw posErrors.paymentMethodNotAvailable();
      throw posErrors.paymentNotCovered(total.toString());
    }
    return {
      method: 'MIXED',
      cash: { received: parsed.value, due: mix.cashDue },
      qr,
      card: null,
      credit: null,
      received: total.add(mix.change),
      change: mix.change,
    };
  }

  /** Cash: what the customer handed over must cover the total; the rest is the change. */
  private settleCash(total: Decimal, receivedText: string): Settlement {
    const tendered = validateCashTendered(total, receivedText.replace(/,$/, ''));
    if (!tendered.ok) {
      if (tendered.error === 'INSUFFICIENT_CASH') throw posErrors.insufficientCash(total.toString());
      throw tendered.error === 'AMOUNT_TOO_LARGE' ? posErrors.amountTooLarge() : posErrors.invalidAmount();
    }
    const cover = paymentsCover(total, [{ method: 'CASH', amount: tendered.received }]);
    if (!cover.ok) throw posErrors.insufficientCash(total.toString());
    return { method: 'CASH', cash: { received: tendered.received, due: total }, qr: null, card: null, credit: null, received: tendered.received, change: cover.change };
  }

  /**
   * A QR (HU-VEN-08) or card (HU-VEN-10) payment: it must be this checkout's, carry the key the sale completes with and be
   * `CONFIRMED`. The cart row is already locked, and confirm and cancel take that lock first, so the status cannot move
   * meanwhile. A QR's amount is the whole total, or a part when it is one line of a mixed payment (`settle` decides); a card's
   * is always the whole total (`settleCard` decides).
   */
  private async loadProviderPayment(
    tx: TenantTransaction,
    cartId: string,
    method: ProviderPaymentMethod,
    paymentId: string,
    key: string,
  ): Promise<ProviderLine> {
    const row = await tx.posCheckoutPayment.findFirst({ where: { id: paymentId, checkoutId: cartId, method } });
    if (!row) throw posErrors.paymentNotFound();
    if (row.idempotencyKey !== key) throw posErrors.idempotencyKeyReused();
    if (!canCompleteWithPayments([{ method, status: row.status }])) throw posErrors.paymentNotConfirmed(row.status);
    return {
      amount: Decimal.of(row.amount.toFixed(2)),
      providerRef: row.providerRef ?? row.id,
      paymentId: row.id,
      reference: row.reference,
    };
  }

  /** Card (HU-VEN-10): it charged the whole total, nothing less (the rest would need another method) and nothing more. */
  private settleCard(total: Decimal, card: ProviderLine): Settlement {
    if (card.amount.cmp(total) < 0) throw posErrors.paymentNotCovered(total.toString());
    if (card.amount.cmp(total) > 0) throw posErrors.totalChanged(card.amount.toString(), total.toString());
    const cover = paymentsCover(total, [{ method: 'CARD', amount: total }]);
    if (!cover.ok) throw posErrors.paymentNotCovered(total.toString());
    return { method: 'CARD', cash: null, qr: null, card, credit: null, received: total, change: cover.change };
  }

  /**
   * Credit (HU-VEN-34): the customer is read inside the transaction, so a flag turned off after `pay` is refused. The whole
   * total goes to the customer's account; nothing is received, so the change is zero. The due date is today (La Paz) plus the term.
   */
  private settleCredit(
    total: Decimal,
    termDays: number,
    customer: { creditEnabled: boolean; documentType: number } | null,
  ): Settlement {
    const eligibility = creditEligibility(customer);
    if (!eligibility.ok) throw this.creditRefusal(eligibility);
    return {
      method: 'CREDIT',
      cash: null,
      qr: null,
      card: null,
      credit: { amount: total, termDays, dueDate: creditDueDate(laPazToday(new Date()), termDays) },
      received: Decimal.zero(MONEY_SCALE),
      change: Decimal.zero(MONEY_SCALE),
    };
  }

  private creditRefusal(eligibility: Extract<CreditEligibility, { ok: false }>) {
    if (eligibility.reason === 'CUSTOMER_REQUIRED') return posErrors.creditCustomerRequired();
    if (eligibility.reason === 'CREDIT_NOT_ENABLED') return posErrors.creditNotEnabled();
    return posErrors.creditNitRequired();
  }

  /** What the payment screen needs to offer credit: whether the cart's customer qualifies, why not, and the terms to show. */
  private async creditInfo(tx: TenantTransaction, customer: { creditEnabled: boolean; documentType: number } | null): Promise<PosCreditInfo> {
    const eligibility = creditEligibility(customer);
    return {
      available: eligibility.ok,
      reason: eligibility.ok ? null : eligibility.reason,
      termOptions: await this.settings.get('sales.creditTermDays', tx),
    };
  }

  /** A credit takes the whole sale: a QR or card of this cart that is waiting or already paid blocks it (the customer may have paid). */
  private async assertNoProviderPayment(tx: TenantTransaction, cartId: string): Promise<void> {
    const live = await tx.posCheckoutPayment.findFirst({
      where: { checkoutId: cartId, method: { in: ['QR', 'CARD'] }, status: { in: ['PENDING', 'CONFIRMED'] } },
      select: { id: true },
    });
    if (live) throw posErrors.paymentAlreadyPending();
  }

  /**
   * Drops the payments of the given provider methods the cart still waits for (going back to the cart, or paying another way).
   * One that was already confirmed cannot be dropped: the customer paid, so the cashier finishes the sale (a refund is a
   * return, HU-VEN-21). A card still waiting for the terminal is never dropped here either: the terminal may have charged the
   * customer already, so the cashier reports the outcome or cancels it on purpose (`PosCardPaymentService.cancel`) first. A QR
   * is different: it has a deadline, so dropping it is safe.
   */
  private async dropProviderPayments(tx: TenantTransaction, cartId: string, methods: ProviderPaymentMethod[]): Promise<void> {
    const rows = await tx.posCheckoutPayment.findMany({
      where: { checkoutId: cartId, method: { in: methods }, status: { in: ['PENDING', 'CONFIRMED'] } },
    });
    if (rows.some((row) => row.status === 'CONFIRMED')) throw posErrors.paymentAlreadyConfirmed();
    if (rows.some((row) => row.method === 'CARD' && row.status === 'PENDING')) throw posErrors.cardAwaitingOutcome();
    for (const row of rows) {
      const method = row.method as ProviderPaymentMethod;
      const next = paymentMachine.next(row.status, 'cancel');
      try {
        if (row.providerRef) await this.providers[method].cancel(row.providerRef);
      } catch {
        // the provider no longer knows the payment (or already dropped it): the row is what counts
      }
      await tx.posCheckoutPayment.update({ where: { id: row.id }, data: { status: next } });
      await this.audit.log(
        {
          action: `sales.payment.${method.toLowerCase()}-cancel`,
          entity: 'PosCheckoutPayment',
          entityId: row.id,
          before: { status: row.status },
          after: { status: next, reason: 'back-to-cart' },
        },
        tx as unknown as Prisma.TransactionClient,
      );
    }
  }

  /** The sale a payment key already produced, as the caller's own; another cashier's key does not exist for me. */
  private async findCompleted(
    db: TenantDb,
    key: string,
    expectedTotal: string,
  ): Promise<CompletePosCheckoutResponse | null> {
    const payment = await db.posCheckoutPayment.findFirst({
      where: { idempotencyKey: key },
      select: {
        method: true,
        checkout: {
          select: {
            cashierId: true,
            customer: { select: { email: true } },
            sale: {
              select: {
                id: true,
                number: true,
                createdAt: true,
                total: true,
                invoice: { select: { customerTaxName: true } },
                payments: { select: { method: true, amount: true, change: true, dueDate: true } },
              },
            },
          },
        },
      },
    });
    if (!payment) return null;
    const { checkout } = payment;
    if (checkout.cashierId !== this.userId()) throw posErrors.checkoutNotFound();
    // a confirmed QR carries the key before its sale exists: this is the first `complete` with it, not a retry
    if (!checkout.sale) {
      if (payment.method === 'QR' || payment.method === 'CARD') return null;
      throw posErrors.checkoutNotFound();
    }
    const sale = checkout.sale;
    // the key is bound to the sale it produced: the same key with another total is a client mistake, not a retry
    if (!sale.total.eq(expectedTotal)) throw posErrors.idempotencyKeyReused();
    return {
      sale: {
        saleId: sale.id,
        number: sale.number,
        createdAt: sale.createdAt.toISOString(),
        total: sale.total.toFixed(2),
        // what the customer handed over: every payment of the sale plus the change given back; a credit is not handed over
        received: sale.payments
          .filter((p) => p.method !== 'CREDIT')
          .reduce((acc, p) => acc.add(p.amount.add(p.change)), new Prisma.Decimal(0))
          .toFixed(2),
        change: sale.payments.reduce((acc, p) => acc.add(p.change), new Prisma.Decimal(0)).toFixed(2),
        customerName: sale.invoice?.customerTaxName ?? 'S/N',
        invoiceStatus: 'PENDING',
        customerEmail: checkout.customer?.email ?? null,
        dueDate: sale.payments.find((p) => p.dueDate)?.dueDate?.toISOString().slice(0, 10) ?? null,
      },
    };
  }

  /** A negative `SALE` movement through the stock service, the only writer of stock. Not enough stock names the product. */
  private async takeStock(
    tx: TenantTransaction,
    shift: CurrentCashShift,
    productId: string,
    quantity: number,
    saleId: string,
    number: string,
  ) {
    await this.assertAvailable(tx, shift.warehouse.id, productId, quantity);
    try {
      await this.stock.apply(tx, {
        productId,
        warehouseId: shift.warehouse.id,
        type: 'SALE',
        quantity: -quantity,
        reason: `Venta ${number}`,
        refType: SALE_REF_TYPE,
        refId: saleId,
        refNumber: number,
      });
    } catch (err) {
      if (
        err instanceof UnprocessableEntityException &&
        (err.getResponse() as { code?: string }).code === 'INSUFFICIENT_STOCK'
      ) {
        const level = await tx.stockLevel.findFirst({
          where: { productId, warehouseId: shift.warehouse.id },
          select: { quantity: true, reserved: true },
        });
        throw posErrors.insufficientStockFor(productId, Math.max(0, availableQuantity(level)));
      }
      throw err;
    }
  }

  /**
   * Available stock (`quantity − reserved`) under the same locks `apply` takes, product first and then its level. The stock
   * service only refuses to go below zero; units reserved for an order (HU-VEN-19) are not the sale's to take.
   */
  private async assertAvailable(
    tx: TenantTransaction,
    warehouseId: string,
    productId: string,
    quantity: number,
  ): Promise<void> {
    if (await this.settings.get('inventory.allowNegativeStock', tx)) return;
    const companyId = this.companyId();
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${productId}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;
    const [level] = await tx.$queryRaw<{ quantity: number; reserved: number }[]>`
      SELECT quantity, reserved FROM stock_levels
      WHERE product_id = ${productId}::uuid AND warehouse_id = ${warehouseId}::uuid AND company_id = ${companyId}::uuid
      FOR UPDATE`;
    const available = availableQuantity(level);
    if (quantity > available) throw posErrors.insufficientStockFor(productId, Math.max(0, available));
  }

  /**
   * `FOR SHARE` on the shift row, which must still be `OPEN`: a close waits for the sales in flight. Lock order of a sale: shift,
   * then the cart row, then the document sequence, then products and stock levels. Anything that locks a shift (closing it,
   * HU-VEN-23) must not take a cart lock while holding it in the other order.
   */
  private async lockOpenShift(tx: TenantTransaction, shiftId: string): Promise<void> {
    const rows = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM cash_shifts WHERE id = ${shiftId}::uuid AND company_id = ${this.companyId()}::uuid FOR SHARE`;
    if (rows[0]?.status !== 'OPEN') throw cashErrors.shiftNotOpen();
  }

  /** The totals of the cart, with the customer's discount and the company's rounding: the same `cartTotals` the ERP uses. */
  private async totalsOf(tx: TenantTransaction, cart: CartForPayment) {
    const roundingMode = await this.settings.get('sales.roundingMode', tx);
    const customer = cart.customer;
    return cartTotals(
      cart.items.map((item) => ({ unitPrice: item.unitPrice.toFixed(2), quantity: item.quantity })),
      {
        roundingMode,
        discount:
          customer && customer.discountType !== 'NONE'
            ? { type: customer.discountType, value: customer.discountValue.toFixed(2) }
            : null,
      },
    );
  }

  private loadCart(tx: TenantTransaction, checkoutId: string): Promise<CartForPayment> {
    return tx.posCheckout.findFirstOrThrow({ where: { id: checkoutId }, include: CART_FOR_PAYMENT });
  }

  /** My cart, still in the cashier's hands (`OPEN` or `PAYING`); another cashier's cart does not exist for me. */
  private async myCart(): Promise<{ id: string }> {
    const cart = await this.prisma.tenant.posCheckout.findFirst({
      where: { cashierId: this.userId(), status: { in: MY_CART_STATUSES } },
      select: { id: true },
    });
    if (!cart) throw posErrors.checkoutNotFound();
    return cart;
  }

  /** `FOR UPDATE` on the cart row; two calls on the same cart run one after the other. */
  async lockStatus(tx: TenantTransaction, checkoutId: string): Promise<PosCheckoutStatus> {
    const rows = await tx.$queryRaw<{ status: PosCheckoutStatus }[]>`
      SELECT status::text AS status FROM pos_checkouts WHERE id = ${checkoutId}::uuid AND company_id = ${this.companyId()}::uuid FOR UPDATE`;
    if (!rows[0]) throw posErrors.checkoutNotFound();
    return rows[0].status;
  }

  /** The next status through `posCheckoutMachine`; a transition it does not allow is a 409 `INVALID_TRANSITION`. */
  private next(status: PosCheckoutStatus, event: PosCheckoutEvent): PosCheckoutStatus {
    try {
      return posCheckoutMachine.next(status, event);
    } catch (err) {
      if (err instanceof InvalidTransitionError) throw posErrors.invalidTransition(err.from, err.event);
      throw err;
    }
  }

  private companyId(): string {
    const companyId = this.cls.get('companyId');
    if (!companyId) throw new Error('POS payment outside a company context');
    return companyId;
  }

  private userId(): string {
    const userId = this.cls.get('userId');
    if (!userId) throw new Error('POS payment outside a user context');
    return userId;
  }
}
