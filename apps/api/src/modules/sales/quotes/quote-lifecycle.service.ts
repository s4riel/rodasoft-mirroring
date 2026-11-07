import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  cartTotals,
  effectiveQuoteStatus,
  InvalidTransitionError,
  isValidEmail,
  laPazToday,
  lineTotal,
  normalizeWhatsappNumber,
  quoteDefaultValidUntil,
  quoteMachine,
  quoteShareText,
  quoteValidityError,
  type QuoteDetail,
  type QuoteSendLogEntry,
  type RenewQuoteInput,
  type SendQuoteInput,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../../common/audit/audit.service';
import type { AppClsStore } from '../../../common/cls';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SettingsService } from '../../../common/settings/settings.service';
import { quoteErrors } from './quotes.errors';
import { QuotesService } from './quotes.service';

type Tx = Parameters<Parameters<PrismaService['tenant']['$transaction']>[0]>[0];
type QuoteState = Parameters<typeof quoteMachine.next>[0];
type QuoteStep = Parameters<typeof quoteMachine.next>[1];

const day = (date: Date): string => date.toISOString().slice(0, 10);
const asClient = (tx: Tx): Prisma.TransactionClient => tx as unknown as Prisma.TransactionClient;

/**
 * What happens to a quote after it exists (HU-VEN-17, HU-VEN-18): it is sent and the sending is recorded, it is renewed
 * when it expired, or it is closed as rejected. Every command locks the quote row, moves the status only through
 * `quoteMachine` and writes its audit row in the same transaction. A quote never touches stock.
 */
@Injectable()
export class QuoteLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly quotes: QuotesService,
  ) {}

  /** Sends the quote and appends the sending to its log. The first sending moves a draft to `SENT`; a re-send keeps it. */
  async send(quoteId: string, input: SendQuoteInput): Promise<QuoteDetail> {
    const companyId = this.requireCompany();
    const userId = this.requireUser();
    const to = this.recipientOf(input);
    const today = laPazToday(new Date());
    const [user, company] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
      this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { tradeName: true } }),
    ]);

    await this.prisma.tenant.$transaction(async (tx) => {
      await this.lock(tx, quoteId, companyId);
      const quote = await tx.quote.findFirstOrThrow({
        where: { id: quoteId },
        include: {
          customer: { select: { name: true } },
          items: { orderBy: { sortOrder: 'asc' }, include: { product: { select: { manufacturerCode: true, name: true } } } },
        },
      });
      const validUntil = day(quote.validUntil);
      if (quote.status === 'ACCEPTED' || quote.status === 'REJECTED') throw quoteErrors.invalidTransition(quote.status);
      if (validUntil < today) throw quote.status === 'DRAFT' ? quoteErrors.draftExpired() : quoteErrors.expired();
      const next = quote.status === 'DRAFT' ? this.next(quote.status, 'send', today, validUntil) : quote.status;

      const log = quote.sendLog as unknown as QuoteSendLogEntry[];
      const entry: QuoteSendLogEntry = { channel: input.channel, to, at: new Date().toISOString(), userId, userName: user?.name ?? null };
      await tx.quote.update({ where: { id: quote.id }, data: { status: next, sendLog: [...log, entry] as unknown as Prisma.InputJsonValue } });

      if (input.channel === 'EMAIL' && to) {
        const text = quoteShareText(
          {
            number: quote.number,
            company: company.tradeName,
            customerName: quote.customer.name,
            validUntil,
            lines: quote.items.map((item) => ({
              quantity: item.quantity,
              code: item.product.manufacturerCode,
              name: item.product.name,
              lineTotal: item.lineTotal.toFixed(2),
            })),
            total: quote.total.toFixed(2),
          },
          input.message,
        );
        await this.outbox.publish(
          'sales.quote-email',
          { email: to, number: quote.number, company: company.tradeName, text },
          { tx, idempotencyKey: `quote-email:${quote.id}:${log.length}` },
        );
      }
      await this.audit.log(
        {
          action: 'sales.quote.send',
          entity: 'Quote',
          entityId: quote.id,
          before: { status: quote.status },
          after: { status: next, channel: input.channel, to },
        },
        asClient(tx),
      );
    });
    return this.quotes.detail(quoteId);
  }

  /**
   * Gives an expired quote a new validity (today plus `sales.quoteValidityDays` unless a day is typed) and prices it again
   * with today's prices and the customer's current discount. A sent quote whose day passed is expired first, so the audit
   * trail shows both steps.
   */
  async renew(quoteId: string, input: RenewQuoteInput): Promise<QuoteDetail> {
    const companyId = this.requireCompany();
    const today = laPazToday(new Date());
    const validityDays = await this.settings.get('sales.quoteValidityDays');
    const validUntil = input.validUntil ?? quoteDefaultValidUntil(today, validityDays);
    const validityError = input.validUntil ? quoteValidityError(validUntil, today) : null;
    if (validityError === 'INVALID_DATE') throw quoteErrors.validityInvalid();
    if (validityError === 'IN_PAST') throw quoteErrors.validityInPast();
    if (validityError === 'TOO_FAR') throw quoteErrors.validityTooFar();

    await this.prisma.tenant.$transaction(async (tx) => {
      await this.lock(tx, quoteId, companyId);
      const quote = await tx.quote.findFirstOrThrow({ where: { id: quoteId }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
      const oldValidUntil = day(quote.validUntil);
      const shown = effectiveQuoteStatus(quote.status, oldValidUntil, today);
      if (shown !== 'EXPIRED') throw quoteErrors.invalidTransition(shown);

      const client = asClient(tx);
      let status = quote.status;
      if (status === 'SENT') {
        status = this.next(status, 'expire', today, oldValidUntil);
        await this.auditExpiry(tx, quote.id, status);
      }
      const renewed = this.next(status, 'renew', today, oldValidUntil);

      const customer = await tx.customer.findFirstOrThrow({ where: { id: quote.customerId } });
      if (customer.status !== 'ACTIVE') throw quoteErrors.customerInactive();
      const products = await tx.product.findMany({
        where: { id: { in: quote.items.map((item) => item.productId) } },
        select: { id: true, status: true, salePrice: true },
      });
      const byId = new Map(products.map((product) => [product.id, product]));
      const priced = quote.items.map((item) => {
        const product = byId.get(item.productId);
        if (!product) throw quoteErrors.productNotFound();
        if (product.status !== 'ACTIVE') throw quoteErrors.productInactive(product.id);
        return { item, quantity: item.quantity, unitPrice: product.salePrice.toFixed(2) };
      });
      const roundingMode = await this.settings.get('sales.roundingMode', tx);
      const totals = cartTotals(priced, { roundingMode, discount: { type: customer.discountType, value: customer.discountValue.toFixed(2) } });
      const afterDiscount = totals.subtotal.sub(totals.discount);

      for (const line of priced) {
        await tx.quoteItem.update({
          where: { id: line.item.id },
          data: { unitPrice: line.unitPrice, lineTotal: lineTotal(line.unitPrice, line.quantity).toString() },
        });
      }
      await tx.quote.update({
        where: { id: quote.id },
        data: {
          status: renewed,
          validUntil: new Date(`${validUntil}T00:00:00Z`),
          subtotal: totals.subtotal.toString(),
          discountType: customer.discountType,
          discountValue: customer.discountValue,
          discountAmount: totals.discount.toString(),
          roundingAmount: totals.total.sub(afterDiscount).toString(),
          total: totals.total.toString(),
        },
      });
      await this.audit.log(
        {
          action: 'sales.quote.renew',
          entity: 'Quote',
          entityId: quote.id,
          before: { status: 'EXPIRED', validUntil: oldValidUntil, total: quote.total.toFixed(2) },
          after: { status: renewed, validUntil, total: totals.total.toString() },
        },
        client,
      );
    });
    return this.quotes.detail(quoteId);
  }

  /** The customer said no: `SENT | EXPIRED → REJECTED`. */
  async reject(quoteId: string): Promise<QuoteDetail> {
    const companyId = this.requireCompany();
    const today = laPazToday(new Date());
    await this.prisma.tenant.$transaction(async (tx) => {
      await this.lock(tx, quoteId, companyId);
      const quote = await tx.quote.findFirstOrThrow({ where: { id: quoteId } });
      const next = this.next(quote.status, 'reject', today, day(quote.validUntil));
      if (quote.status === 'SENT' && day(quote.validUntil) < today) {
        await this.auditExpiry(tx, quote.id, 'EXPIRED');
      }
      await tx.quote.update({ where: { id: quote.id }, data: { status: next } });
      await this.audit.log(
        { action: 'sales.quote.reject', entity: 'Quote', entityId: quote.id, before: { status: quote.status }, after: { status: next } },
        asClient(tx),
      );
    });
    return this.quotes.detail(quoteId);
  }

  /** The recipient as stored in the log: a valid e-mail, a WhatsApp number with country code, or nothing for the PDF. */
  private recipientOf(input: SendQuoteInput): string | null {
    if (input.channel === 'PDF') return null;
    if (input.channel === 'EMAIL') {
      const email = (input.to ?? '').trim();
      if (!isValidEmail(email)) throw quoteErrors.invalidEmail();
      return email;
    }
    const phone = normalizeWhatsappNumber(input.to ?? '');
    if (!phone) throw quoteErrors.phoneInvalid();
    return phone;
  }

  /** The audit row of a sent quote whose validity day passed, written when a command finds it expired. */
  private async auditExpiry(tx: Tx, quoteId: string, expiredStatus: QuoteState): Promise<void> {
    await this.audit.log(
      { action: 'sales.quote.expire', entity: 'Quote', entityId: quoteId, before: { status: 'SENT' }, after: { status: expiredStatus } },
      asClient(tx),
    );
  }

  private next(status: QuoteState, event: QuoteStep, today: string, validUntil: string): QuoteState {
    try {
      return quoteMachine.next(status, event);
    } catch (err) {
      if (err instanceof InvalidTransitionError) throw quoteErrors.invalidTransition(effectiveQuoteStatus(status, validUntil, today));
      throw err;
    }
  }

  private async lock(tx: Tx, quoteId: string, companyId: string): Promise<void> {
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM quotes WHERE id = ${quoteId}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;
    if (!locked) throw quoteErrors.quoteNotFound();
  }

  private requireCompany(): string {
    const id = this.cls.get('companyId');
    if (!id) throw quoteErrors.quoteNotFound();
    return id;
  }

  private requireUser(): string {
    const id = this.cls.get('userId');
    if (!id) throw quoteErrors.quoteNotFound();
    return id;
  }
}
