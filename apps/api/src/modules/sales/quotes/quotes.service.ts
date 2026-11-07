import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  cartTotals,
  effectiveQuoteStatus,
  isQuoteConvertible,
  isQuoteRejectable,
  isQuoteRenewable,
  isQuoteSendable,
  laPazToday,
  lineTotal,
  quoteDefaultValidUntil,
  quoteTimeline,
  quoteValidityError,
  SALES_DOCUMENT_PAGE_SIZE_DEFAULT,
  type CreateQuoteInput,
  type CustomerSearchResponse,
  type QuoteDetail,
  type QuoteEditorContext,
  type QuoteListQuery,
  type QuoteListResponse,
  type QuoteProductResult,
  type QuoteSendLogEntry,
  type QuoteStatus,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../../common/audit/audit.service';
import type { AppClsStore } from '../../../common/cls';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SettingsService } from '../../../common/settings/settings.service';
import { MembershipService } from '../../access/membership.service';
import { codeRank, productSearchWhere } from '../../inventory/product-search-where';
import { CustomersService } from '../customers/customers.service';
import { nextDocumentNumber } from '../document-sequence';
import { quoteErrors } from './quotes.errors';

const SEARCH_LIMIT = 20;
const day = (date: Date): string => date.toISOString().slice(0, 10);

/** The text filter of the lists: the document number or the customer's name or document. */
export function numberOrCustomerFilter(q: string | undefined): Prisma.QuoteWhereInput {
  const text = q?.trim();
  if (!text) return {};
  return {
    OR: [
      { number: { contains: text, mode: 'insensitive' } },
      { customer: { name: { contains: text, mode: 'insensitive' } } },
      { customer: { documentNumber: { contains: text } } },
    ],
  };
}

/**
 * Quotes (HU-VEN-16): the list, the detail and the creation of a draft. A quote reserves nothing; the stock is only held
 * when it becomes an order (`SalesOrdersService.convert`). Prices always come from `Product.salePrice` and the totals
 * from the same `cartTotals` the POS uses, so the preview in the ERP is the total the server saves.
 */
@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly membership: MembershipService,
    private readonly customers: CustomersService,
  ) {}

  /** The default validity and the warehouses of the branches the user operates (the stock column of the editor). */
  async context(): Promise<QuoteEditorContext> {
    const validityDays = await this.settings.get('sales.quoteValidityDays');
    const roundingMode = await this.settings.get('sales.roundingMode');
    const branchIds = await this.operableBranchIds();
    const warehouses = await this.prisma.tenant.warehouse.findMany({
      where: { status: 'ACTIVE', ...(branchIds ? { branchId: { in: branchIds } } : {}) },
      orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, isMain: true },
    });
    return { defaultValidUntil: quoteDefaultValidUntil(laPazToday(new Date()), validityDays), validityDays, roundingMode, warehouses };
  }

  searchCustomers(q: string): Promise<CustomerSearchResponse> {
    return this.customers.search(q);
  }

  /** Active products by code, SKU, name or brand, with the available stock (`quantity − reserved`) of one warehouse. Never costs. */
  async searchProducts(q: string, warehouseId: string): Promise<{ items: QuoteProductResult[] }> {
    const warehouse = await this.prisma.tenant.warehouse.findFirst({ where: { id: warehouseId }, select: { id: true, branchId: true } });
    const branchIds = await this.operableBranchIds();
    if (!warehouse || (branchIds && !branchIds.includes(warehouse.branchId))) throw quoteErrors.warehouseNotFound();
    const search = q.trim();
    if (!search) return { items: [] };

    const select = {
      id: true,
      sku: true,
      manufacturerCode: true,
      name: true,
      salePrice: true,
      brand: { select: { name: true } },
      stockLevels: { where: { warehouseId }, select: { quantity: true, reserved: true } },
    } satisfies Prisma.ProductSelect;
    const where = productSearchWhere(search);
    const orderBy: Prisma.ProductOrderByWithRelationInput[] = [{ manufacturerCode: 'asc' }, { id: 'asc' }];
    const [exact, matching] = await Promise.all([
      this.prisma.tenant.product.findMany({ where: { AND: [{ status: 'ACTIVE' }, where.exact] }, orderBy, take: SEARCH_LIMIT, select }),
      this.prisma.tenant.product.findMany({ where: { AND: [{ status: 'ACTIVE' }, where.matching] }, orderBy, take: SEARCH_LIMIT * 3, select }),
    ]);
    const seen = new Set<string>();
    const rows = [...exact, ...matching]
      .filter((p) => (seen.has(p.id) ? false : !!seen.add(p.id)))
      .sort((a, b) => codeRank(a.manufacturerCode, search) - codeRank(b.manufacturerCode, search))
      .slice(0, SEARCH_LIMIT);
    return {
      items: rows.map((p) => ({
        id: p.id,
        sku: p.sku,
        code: p.manufacturerCode,
        name: p.name,
        brandName: p.brand.name,
        salePrice: p.salePrice.toFixed(2),
        available: p.stockLevels[0] ? p.stockLevels[0].quantity - p.stockLevels[0].reserved : 0,
      })),
    };
  }

  async list(query: QuoteListQuery): Promise<QuoteListResponse> {
    const today = laPazToday(new Date());
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? SALES_DOCUMENT_PAGE_SIZE_DEFAULT;
    const where: Prisma.QuoteWhereInput = { AND: [numberOrCustomerFilter(query.q), statusFilter(query.status, today)] };
    const [rows, total] = await Promise.all([
      this.prisma.tenant.quote.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          number: true,
          status: true,
          validUntil: true,
          total: true,
          createdAt: true,
          customer: { select: { name: true } },
          items: { select: { quantity: true } },
          salesOrders: { where: { status: { not: 'CANCELLED' } }, select: { number: true }, take: 1 },
        },
      }),
      this.prisma.tenant.quote.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        number: row.number,
        customerName: row.customer.name,
        createdAt: row.createdAt.toISOString(),
        validUntil: day(row.validUntil),
        itemsCount: row.items.reduce((sum, item) => sum + item.quantity, 0),
        total: row.total.toFixed(2),
        status: effectiveQuoteStatus(row.status, day(row.validUntil), today),
        orderNumber: row.salesOrders[0]?.number ?? null,
      })),
      total,
      page,
      pageSize,
    };
  }

  async detail(id: string): Promise<QuoteDetail> {
    const quote = await this.prisma.tenant.quote.findFirst({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, documentNumber: true, email: true, phone: true } },
        items: { orderBy: { sortOrder: 'asc' }, include: { product: { select: { sku: true, manufacturerCode: true, name: true } } } },
        salesOrders: { where: { status: { not: 'CANCELLED' } }, select: { id: true, number: true }, take: 1 },
      },
    });
    if (!quote) throw quoteErrors.quoteNotFound();
    const [creator, company, available] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: quote.createdById }, select: { name: true } }),
      this.prisma.company.findUniqueOrThrow({ where: { id: quote.companyId }, select: { tradeName: true } }),
      this.availableByProduct(quote.items.map((item) => item.productId)),
    ]);
    const today = laPazToday(new Date());
    const validUntil = day(quote.validUntil);
    const status = effectiveQuoteStatus(quote.status, validUntil, today);
    const sendLog = quote.sendLog as unknown as QuoteSendLogEntry[];
    const closed = quote.status === 'REJECTED' || quote.status === 'ACCEPTED';
    const closing = closed
      ? await this.prisma.auditLog.findFirst({
          where: { companyId: quote.companyId, entity: 'Quote', entityId: quote.id, action: { in: ['sales.quote.reject', 'sales.quote.accept'] } },
          orderBy: { id: 'desc' },
          select: { createdAt: true },
        })
      : null;
    return {
      id: quote.id,
      number: quote.number,
      status,
      customer: { id: quote.customer.id, name: quote.customer.name, documentNumber: quote.customer.documentNumber },
      customerEmail: quote.customer.email,
      customerPhone: quote.customer.phone,
      company: company.tradeName,
      sendLog,
      timeline: quoteTimeline({
        status,
        createdDay: laPazToday(quote.createdAt),
        sentDay: sendLog[0] ? laPazToday(new Date(sendLog[0].at)) : null,
        validUntil,
        closedDay: closed ? laPazToday(closing?.createdAt ?? quote.updatedAt) : null,
      }),
      canSend: isQuoteSendable(status),
      canRenew: isQuoteRenewable(status),
      canReject: isQuoteRejectable(status),
      createdAt: quote.createdAt.toISOString(),
      createdByName: creator?.name ?? null,
      validUntil,
      subtotal: quote.subtotal.toFixed(2),
      discountType: quote.discountType,
      discountValue: quote.discountValue.toFixed(2),
      discountAmount: quote.discountAmount.toFixed(2),
      roundingAmount: quote.roundingAmount.toFixed(2),
      total: quote.total.toFixed(2),
      lines: quote.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        sku: item.product.sku,
        code: item.product.manufacturerCode,
        name: item.product.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toFixed(2),
        lineTotal: item.lineTotal.toFixed(2),
        available: available.get(item.productId) ?? null,
      })),
      order: quote.salesOrders[0] ?? null,
      convertible: isQuoteConvertible(quote.status, validUntil, today),
    };
  }

  /** A draft quote `COT-000012`. Nothing is reserved. Totals use the customer's discount and the company's rounding. */
  async create(input: CreateQuoteInput): Promise<QuoteDetail> {
    const companyId = this.requireCompany();
    const userId = this.requireUser();
    const today = laPazToday(new Date());
    const validityDays = await this.settings.get('sales.quoteValidityDays');
    const validUntil = input.validUntil ?? quoteDefaultValidUntil(today, validityDays);
    const validityError = input.validUntil ? quoteValidityError(validUntil, today) : null;
    if (validityError === 'INVALID_DATE') throw quoteErrors.validityInvalid();
    if (validityError === 'IN_PAST') throw quoteErrors.validityInPast();
    if (validityError === 'TOO_FAR') throw quoteErrors.validityTooFar();
    if (input.lines.length === 0) throw quoteErrors.quoteEmpty();
    if (input.lines.some((line) => !Number.isInteger(line.quantity) || line.quantity < 1)) throw quoteErrors.invalidQuantity();

    const id = await this.prisma.tenant.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({ where: { id: input.customerId } });
      if (!customer) throw quoteErrors.customerNotFound();
      if (customer.status !== 'ACTIVE') throw quoteErrors.customerInactive();

      const productIds = [...new Set(input.lines.map((line) => line.productId))];
      const products = await tx.product.findMany({ where: { id: { in: productIds } }, select: { id: true, status: true, salePrice: true } });
      const byId = new Map(products.map((product) => [product.id, product]));
      for (const line of input.lines) {
        const product = byId.get(line.productId);
        if (!product) throw quoteErrors.productNotFound();
        if (product.status !== 'ACTIVE') throw quoteErrors.productInactive(product.id);
      }

      const roundingMode = await this.settings.get('sales.roundingMode', tx);
      const priced = input.lines.map((line) => ({ ...line, unitPrice: (byId.get(line.productId) as { salePrice: Prisma.Decimal }).salePrice.toFixed(2) }));
      const totals = cartTotals(priced, { roundingMode, discount: { type: customer.discountType, value: customer.discountValue.toFixed(2) } });
      const afterDiscount = totals.subtotal.sub(totals.discount);
      const number = await nextDocumentNumber(tx, companyId, 'quote');

      const quote = await tx.quote.create({
        data: {
          companyId,
          number,
          customerId: customer.id,
          validUntil: new Date(`${validUntil}T00:00:00Z`),
          subtotal: totals.subtotal.toString(),
          discountType: customer.discountType,
          discountValue: customer.discountValue,
          discountAmount: totals.discount.toString(),
          roundingAmount: totals.total.sub(afterDiscount).toString(),
          total: totals.total.toString(),
          createdById: userId,
          items: {
            create: priced.map((line, index) => ({
              companyId,
              productId: line.productId,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              lineTotal: lineTotal(line.unitPrice, line.quantity).toString(),
              sortOrder: index,
            })),
          },
        },
        select: { id: true },
      });
      await this.audit.log(
        {
          action: 'sales.quote.create',
          entity: 'Quote',
          entityId: quote.id,
          after: { number, customerId: customer.id, validUntil, total: totals.total.toString(), lines: priced.length },
        },
        tx as unknown as Prisma.TransactionClient,
      );
      return quote.id;
    });
    return this.detail(id);
  }

  /** `quantity − reserved` of each product in the main warehouse of the user's branch (the stock column of the detail). */
  private async availableByProduct(productIds: string[]): Promise<Map<string, number>> {
    const branchIds = await this.operableBranchIds();
    const warehouse = await this.prisma.tenant.warehouse.findFirst({
      where: { status: 'ACTIVE', isMain: true, ...(branchIds ? { branchId: { in: branchIds } } : {}) },
      // several branches: the same main warehouse every time, not whichever row comes first
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    if (!warehouse) return new Map();
    const levels = await this.prisma.tenant.stockLevel.findMany({
      where: { warehouseId: warehouse.id, productId: { in: productIds } },
      select: { productId: true, quantity: true, reserved: true },
    });
    const result = new Map<string, number>(productIds.map((id) => [id, 0]));
    for (const level of levels) result.set(level.productId, level.quantity - level.reserved);
    return result;
  }

  private async operableBranchIds(): Promise<string[] | null> {
    const membershipId = this.cls.get('membershipId');
    return membershipId ? this.membership.operableBranchIds(membershipId) : [];
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

/** A sent quote past its day lists as expired, so the filter follows the status the list shows. */
function statusFilter(status: QuoteStatus | undefined, today: string): Prisma.QuoteWhereInput {
  const todayDate = new Date(`${today}T00:00:00Z`);
  switch (status) {
    case undefined:
      return {};
    case 'EXPIRED':
      return { OR: [{ status: 'EXPIRED' }, { status: 'SENT', validUntil: { lt: todayDate } }] };
    case 'SENT':
      return { status: 'SENT', validUntil: { gte: todayDate } };
    default:
      return { status };
  }
}
