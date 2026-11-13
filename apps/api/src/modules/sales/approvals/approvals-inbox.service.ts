import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  APPROVAL_INBOX_MAX,
  approvalTypesFor,
  Decimal,
  isApprovalType,
  laPazToday,
  type ApprovalInboxGroup,
  type ApprovalInboxItem,
  type ApprovalInboxKpis,
  type ApprovalInboxResponse,
  type ApprovalInboxSummary,
  type ApprovalType,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../../../common/cls';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { MembershipService } from '../../access/membership.service';
import { SaleVisibilityService } from '../sales/sale-visibility.service';
import { approvalErrors } from './approvals.errors';

/** Requests read at once. Far above what the inbox lists (`APPROVAL_INBOX_MAX`); the rest is reported as `truncated`. */
const LOAD_MAX = 1000;

/** What the inbox shows of the thing a request is about. */
interface Subject {
  number: string;
  saleNumber: string | null;
  customerName: string | null;
  registerName: string | null;
  pieces: number | null;
  amount: string | null;
  /** The shift's cashier, who may not review their own closing. */
  ownerId: string | null;
}

interface RequestRow {
  id: string;
  type: ApprovalType;
  subjectId: string;
  status: string;
  requestedById: string;
  reason: string | null;
  requesterComment: string | null;
  createdAt: Date;
}

const REQUEST_SELECT = { id: true, type: true, subjectId: true, status: true, requestedById: true, reason: true, requesterComment: true, createdAt: true } as const;

/** Negative: the money goes out of the company. */
const outflow = (value: { toFixed(digits: number): string }): string => Decimal.of(value.toFixed(2)).neg().toString();

/**
 * The approvals inbox (HU-VEN-29, VP-25): the pending `ApprovalRequest`s of the types the caller may decide, each with the little
 * of its sale, shift, return or cash movement that the card shows. It reads only. The subjects of each type are loaded in one
 * query per type, never one per request. A request is visible when its subject is: the branch of the sale, shift, return or
 * expense must be one the caller operates, and a cancellation also follows the visibility of the sales history.
 */
@Injectable()
export class ApprovalsInboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly membership: MembershipService,
    private readonly visibility: SaleVisibilityService,
  ) {}

  async list(type?: string): Promise<ApprovalInboxResponse> {
    if (type !== undefined && !isApprovalType(type)) throw approvalErrors.invalidFilter('type');
    const { types, pending, decided, subjects } = await this.load();
    const userId = this.cls.get('userId') ?? '';
    const names = await this.userNames(pending.map((row) => row.requestedById));

    const visible = pending.filter((row) => subjects.has(key(row)));
    const shown = visible.slice(0, APPROVAL_INBOX_MAX);
    const items = shown.map((row): ApprovalInboxItem => {
      const subject = subjects.get(key(row)) as Subject;
      return {
        id: row.id,
        type: row.type,
        subjectId: row.subjectId,
        number: subject.number,
        saleNumber: subject.saleNumber,
        customerName: subject.customerName,
        registerName: subject.registerName,
        pieces: subject.pieces,
        requestedBy: names.get(row.requestedById) ?? '',
        requestedAt: row.createdAt.toISOString(),
        reason: row.reason,
        comment: row.requesterComment,
        amount: subject.amount,
        // nobody reviews their own closing (decision #17)
        canDecide: !(row.type === 'CASH_DIFFERENCE' && subject.ownerId === userId),
      };
    });

    const asked = type === undefined ? types : types.filter((t) => t === type);
    const groups = asked.map(
      (t): ApprovalInboxGroup => ({ type: t, count: visible.filter((row) => row.type === t).length, items: items.filter((item) => item.type === t) }),
    );
    const today = decided.filter((row) => subjects.has(key(row)));
    const kpis: ApprovalInboxKpis = {
      pending: visible.length,
      oldestAt: visible[0]?.createdAt.toISOString() ?? null,
      approvedToday: today.filter((row) => row.status === 'APPROVED').length,
      // an observed shift is a rejected request
      rejectedToday: today.filter((row) => row.status === 'REJECTED').length,
    };
    return { groups, kpis, truncated: visible.length > APPROVAL_INBOX_MAX || pending.length >= LOAD_MAX };
  }

  async summary(): Promise<ApprovalInboxSummary> {
    const { pending, subjects } = await this.load({ withDecided: false });
    return { pending: pending.filter((row) => subjects.has(key(row))).length };
  }

  /** The pending requests of the permitted types, oldest first, the decisions of today, and the subjects the caller may see. */
  private async load(opts: { withDecided: boolean } = { withDecided: true }) {
    const membershipId = this.cls.get('membershipId') ?? '';
    const granted = membershipId ? await this.membership.permissions(membershipId) : new Set<string>();
    const types = approvalTypesFor(granted);
    if (types.length === 0) return { types, pending: [] as RequestRow[], decided: [] as RequestRow[], subjects: new Map<string, Subject>() };

    const dayStart = new Date(`${laPazToday(new Date())}T00:00:00-04:00`);
    const [pending, decided] = await Promise.all([
      this.prisma.tenant.approvalRequest.findMany({
        where: { status: 'PENDING', type: { in: types } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: LOAD_MAX,
        select: REQUEST_SELECT,
      }),
      // the badge only counts what waits: it does not need today's decisions
      opts.withDecided
        ? this.prisma.tenant.approvalRequest.findMany({
            where: { status: { in: ['APPROVED', 'REJECTED'] }, type: { in: types }, decidedAt: { gte: dayStart } },
            orderBy: { decidedAt: 'desc' },
            take: LOAD_MAX,
            select: REQUEST_SELECT,
          })
        : Promise.resolve([]),
    ]);
    const subjects = await this.subjectsOf([...pending, ...decided]);
    return { types, pending, decided, subjects };
  }

  /** One batched query per type; the map has an entry only for the subjects the caller may see. */
  private async subjectsOf(rows: RequestRow[]): Promise<Map<string, Subject>> {
    const idsOf = (type: ApprovalType) => [...new Set(rows.filter((row) => row.type === type).map((row) => row.subjectId))];
    const membershipId = this.cls.get('membershipId') ?? '';
    const branchIds = membershipId ? await this.membership.operableBranchIds(membershipId) : [];
    const subjects = new Map<string, Subject>();

    const [cancellations, shifts, returns, expenses, exceptions] = await Promise.all([
      this.cancellationSubjects(idsOf('CANCELLATION'), branchIds),
      this.shiftSubjects(idsOf('CASH_DIFFERENCE'), branchIds),
      this.returnSubjects(idsOf('RETURN'), branchIds),
      this.expenseSubjects(idsOf('CASH_EXPENSE'), branchIds),
      this.nitExceptionSubjects(idsOf('NIT_EXCEPTION'), branchIds),
    ]);
    for (const [id, subject] of exceptions) subjects.set(`NIT_EXCEPTION:${id}`, subject);
    for (const [id, subject] of cancellations) subjects.set(`CANCELLATION:${id}`, subject);
    for (const [id, subject] of shifts) subjects.set(`CASH_DIFFERENCE:${id}`, subject);
    for (const [id, subject] of returns) subjects.set(`RETURN:${id}`, subject);
    for (const [id, subject] of expenses) subjects.set(`CASH_EXPENSE:${id}`, subject);
    return subjects;
  }

  private async cancellationSubjects(ids: string[], branchIds: string[] | null): Promise<Map<string, Subject>> {
    if (ids.length === 0) return new Map();
    const scope = await this.visibility.resolve();
    const sales = await this.prisma.tenant.sale.findMany({
      where: { AND: [{ id: { in: ids } }, scope.where, branchIds ? { branchId: { in: branchIds } } : {}] },
      select: {
        id: true,
        number: true,
        total: true,
        customerId: true,
        invoice: { select: { customerTaxName: true } },
        shift: { select: { register: { select: { name: true } } } },
      },
    });
    return new Map(
      sales.map((sale) => [
        sale.id,
        {
          number: sale.number,
          saleNumber: null,
          // a sale without a customer was invoiced to the final consumer: the inbox shows no customer for it
          customerName: sale.customerId !== null ? (sale.invoice?.customerTaxName ?? null) : null,
          registerName: sale.shift?.register.name ?? null,
          pieces: null,
          amount: outflow(sale.total),
          ownerId: null,
        },
      ]),
    );
  }

  /** A NIT exception is about an invoice the SIN refused (HU-FAC-08); the card names the invoice, its sale and the customer. */
  private async nitExceptionSubjects(ids: string[], branchIds: string[] | null): Promise<Map<string, Subject>> {
    if (ids.length === 0) return new Map();
    const scope = await this.visibility.resolve();
    const invoices = await this.prisma.tenant.invoice.findMany({
      where: { AND: [{ id: { in: ids } }, { sale: scope.where }, branchIds ? { branchId: { in: branchIds } } : {}] },
      select: { id: true, number: true, total: true, customerTaxName: true, sale: { select: { number: true } } },
    });
    return new Map(
      invoices.map((invoice) => [
        invoice.id,
        {
          number: invoice.number === null ? invoice.sale.number : String(invoice.number).padStart(6, '0'),
          saleNumber: invoice.sale.number,
          customerName: invoice.customerTaxName,
          registerName: null,
          pieces: null,
          // no money leaves the company: the invoice is just issued with an unverified NIT
          amount: null,
          ownerId: null,
        },
      ]),
    );
  }

  private async shiftSubjects(ids: string[], branchIds: string[] | null): Promise<Map<string, Subject>> {
    if (ids.length === 0) return new Map();
    const shifts = await this.prisma.tenant.cashShift.findMany({
      where: { id: { in: ids }, ...(branchIds ? { register: { branchId: { in: branchIds } } } : {}) },
      select: { id: true, number: true, openedById: true, differenceAmount: true, register: { select: { name: true } } },
    });
    return new Map(
      shifts.map((shift) => [
        shift.id,
        {
          number: shift.number,
          saleNumber: null,
          customerName: null,
          registerName: shift.register.name,
          pieces: null,
          amount: shift.differenceAmount?.toFixed(2) ?? null,
          ownerId: shift.openedById,
        },
      ]),
    );
  }

  private async returnSubjects(ids: string[], branchIds: string[] | null): Promise<Map<string, Subject>> {
    if (ids.length === 0) return new Map();
    const where: Prisma.SaleReturnWhereInput = { id: { in: ids }, ...(branchIds ? { sale: { branchId: { in: branchIds } } } : {}) };
    const returns = await this.prisma.tenant.saleReturn.findMany({
      where,
      select: {
        id: true,
        number: true,
        total: true,
        sale: { select: { number: true, customerId: true, invoice: { select: { customerTaxName: true } } } },
        items: { select: { quantity: true } },
      },
    });
    return new Map(
      returns.map((row) => [
        row.id,
        {
          number: row.number,
          saleNumber: row.sale.number,
          customerName: row.sale.customerId !== null ? (row.sale.invoice?.customerTaxName ?? null) : null,
          registerName: null,
          pieces: row.items.reduce((sum, item) => sum + item.quantity, 0),
          amount: outflow(row.total),
          ownerId: null,
        },
      ]),
    );
  }

  private async expenseSubjects(ids: string[], branchIds: string[] | null): Promise<Map<string, Subject>> {
    if (ids.length === 0) return new Map();
    const movements = await this.prisma.tenant.cashMovement.findMany({
      where: { id: { in: ids }, type: 'EXPENSE', ...(branchIds ? { shift: { register: { branchId: { in: branchIds } } } } : {}) },
      select: { id: true, amount: true, shift: { select: { number: true, register: { select: { name: true } } } } },
    });
    return new Map(
      movements.map((movement) => [
        movement.id,
        {
          // the expense has no number of its own: the card names the shift it leaves from
          number: movement.shift.number,
          saleNumber: null,
          customerName: null,
          registerName: movement.shift.register.name,
          pieces: null,
          amount: outflow(movement.amount),
          ownerId: null,
        },
      ]),
    );
  }

  private async userNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
    return new Map(users.map((user) => [user.id, user.name]));
  }
}

function key(row: { type: ApprovalType; subjectId: string }): string {
  return `${row.type}:${row.subjectId}`;
}
