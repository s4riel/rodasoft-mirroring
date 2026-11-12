import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  creditBalance,
  customerDiscountInputValid,
  laPazToday,
  normalizeNit,
  validateInvoiceDocument,
  type CustomerCreditBalance,
  type CustomerListQuery,
  type CustomerListResponse,
  type CustomerSearchResponse,
  type CustomerSummary,
  type SaleStatus,
  type SaveCustomerInput,
  type UpdateCustomerInput,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../../common/audit/audit.service';
import type { AppClsStore } from '../../../common/cls';
import { PrismaService, type TenantTransaction } from '../../../common/prisma/prisma.service';
import type { CreatePosCustomerDto } from './customers.dto';
import { customerErrors } from './customers.errors';

type CustomerRow = Prisma.CustomerGetPayload<object>;

/** The most customers the POS search shows. */
const SEARCH_LIMIT = 20;
const DEFAULT_PAGE_SIZE = 25;

export function toCustomerSummary(row: CustomerRow): CustomerSummary {
  return {
    id: row.id,
    name: row.name,
    documentType: row.documentType,
    documentNumber: row.documentNumber,
    complement: row.complement,
    email: row.email,
    phone: row.phone,
    creditEnabled: row.creditEnabled,
    discount: { type: row.discountType, value: row.discountValue.toFixed(2) },
    status: row.status,
  };
}

const isUniqueViolation = (err: unknown): boolean => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/** What the audit trail keeps of a customer: enough to see who changed a discount or the credit flag, and from what. */
function auditSnapshot(row: CustomerRow) {
  return {
    name: row.name,
    documentType: row.documentType,
    documentNumber: row.documentNumber,
    complement: row.complement,
    creditEnabled: row.creditEnabled,
    discountType: row.discountType,
    discountValue: row.discountValue.toFixed(2),
    status: row.status,
  };
}

/**
 * Customers (HU-VEN-05, HU-VEN-37): the POS search and quick creation, and the full form of Management with the credit flag
 * and the discount. Every change is audited with its user and date (the audit log stamps both). The discount is applied by the
 * cart (`PosCheckoutService`); nothing here touches a sale.
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly audit: AuditService,
  ) {}

  /** POS search: active customers whose name or document contains the text. */
  async search(q: string): Promise<CustomerSearchResponse> {
    const rows = await this.prisma.tenant.customer.findMany({
      where: { status: 'ACTIVE', ...this.textFilter(q) },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: SEARCH_LIMIT,
    });
    return { items: rows.map(toCustomerSummary) };
  }

  /** Quick creation by a cashier: no discount and no credit (only Management sets those). */
  async quickCreate(dto: CreatePosCustomerDto): Promise<CustomerSummary> {
    return this.create({ ...dto, creditEnabled: false, discountType: 'NONE', discountValue: '0' });
  }

  async list(query: CustomerListQuery): Promise<CustomerListResponse> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const status = query.status ?? 'ACTIVE';
    const where: Prisma.CustomerWhereInput = { ...(status === 'ALL' ? {} : { status }), ...this.textFilter(query.q ?? '') };
    const [rows, total] = await Promise.all([
      this.prisma.tenant.customer.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.tenant.customer.count({ where }),
    ]);
    return { items: rows.map(toCustomerSummary), total, page, pageSize };
  }

  /**
   * What the customer owes on credit sales, derived from the sales (see `creditBalance`): the `CREDIT` payments of their sales that
   * are not cancelled, less the approved returns of each. A read only; collecting against it arrives with HU-CON-03.
   */
  async creditBalance(id: string): Promise<CustomerCreditBalance> {
    await this.get(id);
    const payments = await this.prisma.tenant.salePayment.findMany({
      where: { method: 'CREDIT', sale: { customerId: id } },
      select: { saleId: true, amount: true, dueDate: true, sale: { select: { status: true } } },
    });
    const returns = payments.length
      ? await this.prisma.tenant.saleReturn.groupBy({
          by: ['saleId'],
          where: { saleId: { in: payments.map((payment) => payment.saleId) }, status: 'APPROVED' },
          _sum: { total: true },
        })
      : [];
    const returned = new Map(returns.map((row) => [row.saleId, (row._sum.total ?? new Prisma.Decimal(0)).toFixed(2)]));
    return creditBalance(
      id,
      payments.map((payment) => ({
        status: payment.sale.status as SaleStatus,
        amount: payment.amount.toFixed(2),
        dueDate: (payment.dueDate as Date).toISOString().slice(0, 10),
        returned: returned.get(payment.saleId) ?? '0.00',
      })),
      laPazToday(new Date()),
    );
  }

  async get(id: string): Promise<CustomerSummary> {
    const row = await this.prisma.tenant.customer.findFirst({ where: { id } });
    if (!row) throw customerErrors.notFound();
    return toCustomerSummary(row);
  }

  async create(input: SaveCustomerInput): Promise<CustomerSummary> {
    const data = this.validated(input);
    try {
      return await this.prisma.tenant.$transaction(async (tx) => {
        const created = await tx.customer.create({
          data: { ...data, companyId: this.companyId(), createdById: this.userId(), updatedById: this.userId() },
        });
        await this.audit.log(
          { action: 'sales.customer.create', entity: 'Customer', entityId: created.id, after: auditSnapshot(created) },
          tx as unknown as Prisma.TransactionClient,
        );
        return toCustomerSummary(created);
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      throw await this.duplicateOrSame(data.documentType, data.documentNumber);
    }
  }

  async update(id: string, input: UpdateCustomerInput): Promise<CustomerSummary> {
    try {
      return await this.prisma.tenant.$transaction(async (tx) => {
        const current = await tx.customer.findFirst({ where: { id } });
        if (!current) throw customerErrors.notFound();
        const data = this.validated({
          name: input.name ?? current.name,
          documentType: input.documentType ?? current.documentType,
          documentNumber: input.documentNumber ?? current.documentNumber,
          complement: input.complement === undefined ? current.complement : input.complement,
          email: input.email === undefined ? current.email : input.email,
          phone: input.phone === undefined ? current.phone : input.phone,
          creditEnabled: input.creditEnabled ?? current.creditEnabled,
          discountType: input.discountType ?? current.discountType,
          // changing the type without a value starts from none: a leftover percent must not become a fixed amount
          discountValue: input.discountValue ?? (input.discountType && input.discountType !== current.discountType ? '0' : current.discountValue.toFixed(2)),
          status: input.status ?? current.status,
        });
        const updated = await tx.customer.update({ where: { id }, data: { ...data, updatedById: this.userId() } });
        await this.audit.log(
          {
            action: 'sales.customer.update',
            entity: 'Customer',
            entityId: id,
            before: auditSnapshot(current),
            after: auditSnapshot(updated),
          },
          tx as unknown as Prisma.TransactionClient,
        );
        return toCustomerSummary(updated);
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const current = await this.prisma.tenant.customer.findFirst({ where: { id }, select: { documentType: true, documentNumber: true } });
      throw await this.duplicateOrSame(input.documentType ?? current?.documentType, input.documentNumber ?? current?.documentNumber);
    }
  }

  /** The customer for the cart: it must exist in the company and be active. */
  async requireActive(id: string, db: Pick<TenantTransaction, 'customer'> | PrismaService['tenant'] = this.prisma.tenant): Promise<CustomerRow> {
    const row = await db.customer.findFirst({ where: { id } });
    if (!row) throw customerErrors.notFound();
    if (row.status !== 'ACTIVE') throw customerErrors.inactive();
    return row;
  }

  /** Checks the document and the discount, and returns the columns to store. */
  private validated(input: SaveCustomerInput) {
    const document = validateInvoiceDocument(input.documentType, input.documentNumber, input.complement);
    if (!document.valid) throw customerErrors.invalidNit(document.error);
    if (!customerDiscountInputValid(input.discountType, input.discountValue)) throw customerErrors.invalidDiscount();
    return {
      name: input.name.trim(),
      documentType: input.documentType,
      documentNumber: document.documentNumber,
      complement: document.complement,
      email: input.email ?? null,
      phone: input.phone ?? null,
      creditEnabled: input.creditEnabled,
      discountType: input.discountType,
      discountValue: input.discountValue,
      status: input.status ?? ('ACTIVE' as const),
    };
  }

  private textFilter(q: string): Prisma.CustomerWhereInput {
    const text = q.trim();
    if (!text) return {};
    // text that looks like a document (digits or letters, separators aside) is also searched by document prefix, which the
    // (company, document number) index serves; a name never is
    const document = normalizeNit(text).toUpperCase();
    const looksLikeDocument = /^[0-9A-Z]{3,}$/.test(document) && /[0-9]/.test(document);
    return {
      OR: [
        { name: { contains: text, mode: 'insensitive' } },
        ...(looksLikeDocument ? [{ documentNumber: { startsWith: document } }] : []),
      ],
    };
  }

  /** A unique violation on the document means the customer already exists: answer with it so the POS can use it. */
  private async duplicateOrSame(documentType: number | undefined, documentNumber: string | undefined) {
    const existing =
      documentType !== undefined && documentNumber !== undefined
        ? await this.prisma.tenant.customer.findFirst({
            where: { documentType, documentNumber: normalizeNit(documentNumber).toUpperCase() },
          })
        : null;
    return customerErrors.documentDuplicated(existing ? toCustomerSummary(existing) : null);
  }

  private companyId(): string {
    const companyId = this.cls.get('companyId');
    if (!companyId) throw new Error('Customers outside a company context');
    return companyId;
  }

  private userId(): string {
    const userId = this.cls.get('userId');
    if (!userId) throw new Error('Customers outside a user context');
    return userId;
  }
}
