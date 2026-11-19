import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  canClosePeriod,
  currentVatBookPeriod,
  Decimal,
  isVatBookPeriod,
  listPeriods,
  type PeriodBlocker,
  type PeriodPendingDocument,
  type PeriodPendingPurchase,
  periodCloseBlockers,
  previousVatPeriod,
  validateReopenReason,
  VAT_RATE_PERCENT,
  type VatPeriodBlockers,
  type VatPeriodRow,
  type VatPeriodsResponse,
  type VatPeriodStatus,
  vatBookPeriod,
  vatPeriodActions,
  vatPeriodMachine,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../common/audit/audit.service';
import type { AppClsStore } from '../../common/cls';
import { PrismaService, type TenantTransaction } from '../../common/prisma/prisma.service';
import { VatPeriodGuard } from '../../common/siat/vat-period.guard';
import { dayStart, nextDayStart } from '../inventory/business-days';
import { MembershipService } from '../access/membership.service';
import { invoicingErrors } from './invoicing.errors';

/** Documents the SIAT has not issued (the same set the invoices list calls "not issued", plus rejected ones). */
const NOT_ISSUED = ['PENDING', 'SENDING', 'REJECTED'] as const;
/** The most pending items the close dialog lists. */
const PENDING_ITEMS_MAX = 50;
/** Serialises closing, filing and reopening of every period of a company (the rules compare neighbouring periods). */
const ALL_PERIODS = '*';

interface BookTotals {
  sales: Decimal;
  fiscalDebit: Decimal;
  purchases: Decimal;
  vatCredit: Decimal;
  /** Valid invoices and valid purchases of the month, whatever the status of the period. */
  salesCount: number;
  purchasesCount: number;
}

const zeroTotals = (): BookTotals => ({ sales: Decimal.zero(), fiscalDebit: Decimal.zero(), purchases: Decimal.zero(), vatCredit: Decimal.zero(), salesCount: 0, purchasesCount: 0 });

/**
 * Closing VAT periods (HU-FAC-21). A period is a La Paz month, `OPEN → CLOSED → FILED`, with reopen of a closed one. Closing keeps a
 * snapshot of the book totals and freezes the period: guarded writes (`VatPeriodGuard`) refuse to touch its documents afterwards.
 * Close, file and reopen take the company-wide lock first and the period lock second; guarded writes take the period lock only, so
 * a close and a cancellation or a NIT verification of the same period never interleave.
 */
@Injectable()
export class VatPeriodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly audit: AuditService,
    private readonly guard: VatPeriodGuard,
    private readonly membership: MembershipService,
  ) {}

  /** `GET invoicing/vat-periods`: one row per month from the first document to today, newest first. */
  async list(now = new Date()): Promise<VatPeriodsResponse> {
    const companyId = this.company();
    const first = await this.firstPeriod(now);
    const periods = listPeriods(first, now).reverse();
    const [rows, live, permissions] = await Promise.all([
      this.prisma.tenant.vatPeriod.findMany({ select: { period: true, status: true, closedAt: true, filedAt: true, salesTotal: true, fiscalDebit: true, purchasesTotal: true, vatCredit: true } }),
      this.totals(this.prisma, companyId),
      this.permissions(),
    ]);
    const stored = new Map(rows.map((row) => [row.period, row]));
    const items = periods.map((period): VatPeriodRow => {
      const row = stored.get(period);
      const status: VatPeriodStatus = row?.status ?? 'OPEN';
      // a closed period shows what was frozen; an open one shows the books as they are now
      const totals = row && status !== 'OPEN' && row.salesTotal !== null
        ? {
            sales: Decimal.of(row.salesTotal.toString()),
            fiscalDebit: Decimal.of((row.fiscalDebit ?? 0).toString()),
            purchases: Decimal.of((row.purchasesTotal ?? 0).toString()),
            vatCredit: Decimal.of((row.vatCredit ?? 0).toString()),
          }
        : (live.get(period) ?? zeroTotals());
      return {
        period,
        status,
        salesTotal: totals.sales.toString(),
        salesCount: live.get(period)?.salesCount ?? 0,
        purchasesCount: live.get(period)?.purchasesCount ?? 0,
        fiscalDebit: totals.fiscalDebit.toString(),
        purchasesTotal: totals.purchases.toString(),
        vatCredit: totals.vatCredit.toString(),
        closedAt: status === 'OPEN' ? null : (row?.closedAt?.toISOString() ?? null),
        filedAt: status === 'FILED' ? (row?.filedAt?.toISOString() ?? null) : null,
        actions: vatPeriodActions(status, permissions),
      };
    });
    const closed = items.filter((item) => item.status !== 'OPEN');
    return {
      items,
      kpis: { current: currentVatBookPeriod(now), lastClosed: closed[0]?.period ?? null, filed: items.filter((item) => item.status === 'FILED').length, total: items.length },
    };
  }

  /** `GET invoicing/vat-periods/:period/blockers`: what keeps the period from closing, with the pending items. */
  async blockers(period: string, now = new Date()): Promise<VatPeriodBlockers> {
    this.requirePeriod(period);
    const companyId = this.company();
    const status = await this.guard.statusOf(this.prisma.tenant, companyId, period);
    const previous = await this.previousStatus(this.prisma.tenant, period, now);
    const error = canClosePeriod(period, status, now, previous);
    const pending = await this.pending(this.prisma.tenant, period);
    return { period, error, blockers: pending.blockers, cancellationRequests: pending.cancellationRequests, documents: pending.documents, purchases: pending.purchases };
  }

  /** Closes the period: its books freeze and a snapshot of the totals is kept. */
  async close(period: string, now = new Date()): Promise<VatPeriodRow> {
    this.requirePeriod(period);
    const companyId = this.company();
    const userId = this.user();
    const permissions = await this.permissions();
    const row = await this.prisma.tenant.$transaction(async (tx) => {
      await this.guard.lock(tx, companyId, ALL_PERIODS);
      await this.guard.lock(tx, companyId, period);
      const status = await this.guard.statusOf(tx, companyId, period);
      const error = canClosePeriod(period, status, now, await this.previousStatus(tx, period, now));
      if (error === 'PERIOD_ALREADY_CLOSED') throw invoicingErrors.periodAlreadyClosed(period);
      if (error === 'PERIOD_NOT_ENDED') throw invoicingErrors.periodNotEnded(period);
      if (error === 'PREVIOUS_PERIOD_OPEN') throw invoicingErrors.previousPeriodOpen(previousVatPeriod(period));
      const pending = await this.pending(tx, period);
      if (pending.blockers.length > 0) throw invoicingErrors.periodHasPending(period, pending);

      const next = vatPeriodMachine.next(status, 'close');
      const totals = (await this.totals(tx, companyId, period)).get(period) ?? zeroTotals();
      const closedAt = new Date();
      const snapshot = { salesTotal: totals.sales.toString(), fiscalDebit: totals.fiscalDebit.toString(), purchasesTotal: totals.purchases.toString(), vatCredit: totals.vatCredit.toString() };
      const saved = await tx.vatPeriod.upsert({
        where: { companyId_period: { companyId, period } },
        create: { companyId, period, status: next, closedAt, closedById: userId, ...snapshot },
        update: { status: next, closedAt, closedById: userId, ...snapshot },
        select: { period: true, status: true, closedAt: true, filedAt: true },
      });
      await this.audit.log(
        { action: 'invoicing.period.close', entity: 'VatPeriod', entityId: period, before: { status }, after: { status: next, ...snapshot } },
        tx as unknown as Prisma.TransactionClient,
      );
      return saved;
    });
    return this.row(row, { ...(await this.snapshotOf(period)) }, permissions);
  }

  /** `CLOSED → FILED`: the tax was declared; the period is final. */
  async file(period: string): Promise<VatPeriodRow> {
    this.requirePeriod(period);
    const companyId = this.company();
    const userId = this.user();
    const permissions = await this.permissions();
    const row = await this.prisma.tenant.$transaction(async (tx) => {
      await this.guard.lock(tx, companyId, ALL_PERIODS);
      await this.guard.lock(tx, companyId, period);
      const status = await this.guard.statusOf(tx, companyId, period);
      if (status === 'FILED') throw invoicingErrors.periodFiled(period);
      if (!vatPeriodMachine.can(status, 'file')) throw invoicingErrors.periodNotClosed(period);
      const next = vatPeriodMachine.next(status, 'file');
      const saved = await tx.vatPeriod.update({
        where: { companyId_period: { companyId, period } },
        data: { status: next, filedAt: new Date(), filedById: userId },
        select: { period: true, status: true, closedAt: true, filedAt: true },
      });
      await this.audit.log({ action: 'invoicing.period.file', entity: 'VatPeriod', entityId: period, before: { status }, after: { status: next } }, tx as unknown as Prisma.TransactionClient);
      return saved;
    });
    return this.row(row, await this.snapshotOf(period), permissions);
  }

  /** `CLOSED → OPEN` with a reason: refused when the period is filed or a later one is closed. */
  async reopen(period: string, reason: string): Promise<VatPeriodRow> {
    this.requirePeriod(period);
    const errors = validateReopenReason(reason);
    if (errors.length > 0) throw invoicingErrors.invalidReopen(errors);
    const companyId = this.company();
    const userId = this.user();
    const permissions = await this.permissions();
    const row = await this.prisma.tenant.$transaction(async (tx) => {
      await this.guard.lock(tx, companyId, ALL_PERIODS);
      await this.guard.lock(tx, companyId, period);
      const current = await tx.vatPeriod.findFirst({ where: { period }, select: { status: true, salesTotal: true, fiscalDebit: true, purchasesTotal: true, vatCredit: true } });
      const status: VatPeriodStatus = current?.status ?? 'OPEN';
      if (status === 'FILED') throw invoicingErrors.periodFiled(period);
      if (!vatPeriodMachine.can(status, 'reopen')) throw invoicingErrors.periodNotClosed(period);
      const later = await tx.vatPeriod.findFirst({ where: { period: { gt: period }, status: { in: ['CLOSED', 'FILED'] } }, select: { period: true }, orderBy: { period: 'asc' } });
      if (later) throw invoicingErrors.laterPeriodClosed(later.period);
      const next = vatPeriodMachine.next(status, 'reopen');
      const text = reason.trim();
      const saved = await tx.vatPeriod.update({
        where: { companyId_period: { companyId, period } },
        data: { status: next, closedAt: null, closedById: null, salesTotal: null, fiscalDebit: null, purchasesTotal: null, vatCredit: null, reopenedAt: new Date(), reopenedById: userId, reopenReason: text },
        select: { period: true, status: true, closedAt: true, filedAt: true },
      });
      await this.audit.log(
        {
          action: 'invoicing.period.reopen',
          entity: 'VatPeriod',
          entityId: period,
          before: { status, salesTotal: current?.salesTotal?.toString(), fiscalDebit: current?.fiscalDebit?.toString() },
          after: { status: next, reason: text },
        },
        tx as unknown as Prisma.TransactionClient,
      );
      return saved;
    });
    return this.row(row, {}, permissions);
  }

  // ── helpers ──

  private async snapshotOf(period: string): Promise<Partial<Record<'salesTotal' | 'fiscalDebit' | 'purchasesTotal' | 'vatCredit', string>>> {
    const row = await this.prisma.tenant.vatPeriod.findFirst({ where: { period }, select: { salesTotal: true, fiscalDebit: true, purchasesTotal: true, vatCredit: true } });
    if (!row || row.salesTotal === null) return {};
    return {
      salesTotal: row.salesTotal.toFixed(2),
      fiscalDebit: (row.fiscalDebit ?? new Prisma.Decimal(0)).toFixed(2),
      purchasesTotal: (row.purchasesTotal ?? new Prisma.Decimal(0)).toFixed(2),
      vatCredit: (row.vatCredit ?? new Prisma.Decimal(0)).toFixed(2),
    };
  }

  private async row(
    saved: { period: string; status: VatPeriodStatus; closedAt: Date | null; filedAt: Date | null },
    snapshot: Partial<Record<'salesTotal' | 'fiscalDebit' | 'purchasesTotal' | 'vatCredit', string>>,
    permissions: Set<string>,
  ): Promise<VatPeriodRow> {
    const live = (await this.totals(this.prisma, this.company(), saved.period)).get(saved.period) ?? zeroTotals();
    return {
      period: saved.period,
      status: saved.status,
      salesTotal: snapshot.salesTotal ?? live.sales.toString(),
      salesCount: live.salesCount,
      purchasesCount: live.purchasesCount,
      fiscalDebit: snapshot.fiscalDebit ?? live.fiscalDebit.toString(),
      purchasesTotal: snapshot.purchasesTotal ?? live.purchases.toString(),
      vatCredit: snapshot.vatCredit ?? live.vatCredit.toString(),
      closedAt: saved.status === 'OPEN' ? null : (saved.closedAt?.toISOString() ?? null),
      filedAt: saved.status === 'FILED' ? (saved.filedAt?.toISOString() ?? null) : null,
      actions: vatPeriodActions(saved.status, permissions),
    };
  }

  /** The first month the list shows: the oldest of the first issued invoice, the first purchase and the first period row. */
  private async firstPeriod(now: Date): Promise<string> {
    const [invoice, purchase, period] = await Promise.all([
      this.prisma.tenant.invoice.aggregate({ _min: { issuedAt: true } }),
      this.prisma.tenant.purchaseBookEntry.aggregate({ _min: { period: true } }),
      this.prisma.tenant.vatPeriod.aggregate({ _min: { period: true } }),
    ]);
    const candidates = [invoice._min.issuedAt ? currentVatBookPeriod(invoice._min.issuedAt) : null, purchase._min.period, period._min.period].filter((p): p is string => p !== null);
    return candidates.length > 0 ? candidates.sort()[0] : currentVatBookPeriod(now);
  }

  /** Status of the period before `period`; null when `period` is the first one of the list (nothing before it can be open). */
  private async previousStatus(db: Pick<TenantTransaction, 'vatPeriod' | 'invoice' | 'purchaseBookEntry'>, period: string, now: Date): Promise<VatPeriodStatus | null> {
    const [invoice, purchase, stored] = await Promise.all([
      db.invoice.aggregate({ _min: { issuedAt: true } }),
      db.purchaseBookEntry.aggregate({ _min: { period: true } }),
      db.vatPeriod.aggregate({ _min: { period: true } }),
    ]);
    const candidates = [invoice._min.issuedAt ? currentVatBookPeriod(invoice._min.issuedAt) : null, purchase._min.period, stored._min.period].filter((p): p is string => p !== null);
    const first = candidates.length > 0 ? candidates.sort()[0] : currentVatBookPeriod(now);
    const before = previousVatPeriod(period);
    if (before < first) return null;
    return this.guard.statusOf(db, this.company(), before);
  }

  /** What stops a period from closing: documents not issued, observed purchases and cancellations under way. */
  private async pending(
    db: Pick<TenantTransaction, 'invoice' | 'creditNote' | 'purchaseBookEntry'>,
    period: string,
  ): Promise<{ blockers: PeriodBlocker[]; cancellationRequests: number; documents: PeriodPendingDocument[]; purchases: PeriodPendingPurchase[] }> {
    const days = vatBookPeriod(period) as NonNullable<ReturnType<typeof vatBookPeriod>>;
    const range = { gte: dayStart(days.firstDay), lt: nextDayStart(days.lastDay) };
    const notIssued = { status: { in: [...NOT_ISSUED] }, createdAt: range };
    const [invoices, notes, observed, cancelling] = await Promise.all([
      db.invoice.findMany({ where: notIssued, orderBy: { createdAt: 'asc' }, take: PENDING_ITEMS_MAX, select: { id: true, number: true, status: true, customerTaxName: true, total: true } }),
      db.creditNote.findMany({ where: notIssued, orderBy: { createdAt: 'asc' }, take: PENDING_ITEMS_MAX, select: { id: true, number: true, status: true, customerTaxName: true, total: true } }),
      db.purchaseBookEntry.findMany({ where: { period, status: 'OBSERVED' }, orderBy: { date: 'asc' }, take: PENDING_ITEMS_MAX, select: { id: true, supplierName: true, invoiceNumber: true, total: true } }),
      db.invoice.findMany({ where: { status: 'CANCELLATION_PENDING', issuedAt: range }, orderBy: { issuedAt: 'asc' }, take: PENDING_ITEMS_MAX, select: { id: true, number: true, status: true, customerTaxName: true, total: true } }),
    ]);
    const [invoiceCount, noteCount, observedCount, cancellingCount, requestCount] = await Promise.all([
      db.invoice.count({ where: notIssued }),
      db.creditNote.count({ where: notIssued }),
      db.purchaseBookEntry.count({ where: { period, status: 'OBSERVED' } }),
      db.invoice.count({ where: { status: 'CANCELLATION_PENDING', issuedAt: range } }),
      // a request waiting for a decision: the sale is `CANCELLATION_PENDING` but the SIAT was not asked, so the invoice is still `VALID`
      db.invoice.count({ where: { status: 'VALID', issuedAt: range, sale: { status: 'CANCELLATION_PENDING' } } }),
    ]);
    const document = (kind: PeriodPendingDocument['kind']) => (row: { id: string; number: number | null; status: string; customerTaxName: string; total: Prisma.Decimal }): PeriodPendingDocument => ({
      kind,
      id: row.id,
      number: row.number,
      status: row.status,
      customerName: row.customerTaxName,
      total: row.total.toFixed(2),
    });
    return {
      blockers: periodCloseBlockers({ invoicesNotIssued: invoiceCount, notesNotIssued: noteCount, observedPurchases: observedCount, cancellationsInProgress: cancellingCount }),
      cancellationRequests: requestCount,
      documents: [...invoices.map(document('INVOICE')), ...notes.map(document('CREDIT_NOTE')), ...cancelling.map(document('CANCELLATION'))],
      purchases: observed.map((row) => ({ id: row.id, supplierName: row.supplierName, invoiceNumber: row.invoiceNumber, total: row.total.toFixed(2) })),
    };
  }

  /**
   * The book totals per La Paz month, the same numbers the VAT books add up: net sales (valid invoices less valid credit notes) and
   * their 13 % fiscal debit, and the valid purchases with their credit. One month when `only` is given.
   */
  private async totals(db: Pick<PrismaService, '$queryRaw'>, companyId: string, only?: string): Promise<Map<string, BookTotals>> {
    const days = only ? vatBookPeriod(only) : null;
    const range = days ? { from: dayStart(days.firstDay), to: nextDayStart(days.lastDay) } : null;
    const inRange = (column: Prisma.Sql) => (range ? Prisma.sql`AND ${column} >= ${range.from} AND ${column} < ${range.to}` : Prisma.empty);
    const [invoices, notes, purchases] = await Promise.all([
      db.$queryRaw<{ period: string; total: Prisma.Decimal; debit: Prisma.Decimal; count: number }[]>`
        SELECT to_char(issued_at AT TIME ZONE 'America/La_Paz', 'YYYY-MM') AS period, COUNT(*)::int AS count, COALESCE(SUM(total), 0) AS total, COALESCE(SUM(ROUND(total * ${VAT_RATE_PERCENT}::numeric / 100, 2)), 0) AS debit
        FROM invoices
        WHERE company_id = ${companyId}::uuid AND status IN ('VALID', 'CANCELLATION_PENDING') AND issued_at IS NOT NULL AND number IS NOT NULL AND cuf IS NOT NULL ${inRange(Prisma.sql`issued_at`)}
        GROUP BY 1`,
      db.$queryRaw<{ period: string; total: Prisma.Decimal; debit: Prisma.Decimal }[]>`
        SELECT to_char(issued_at AT TIME ZONE 'America/La_Paz', 'YYYY-MM') AS period, COALESCE(SUM(total), 0) AS total, COALESCE(SUM(vat_adjusted), 0) AS debit
        FROM credit_notes
        WHERE company_id = ${companyId}::uuid AND status = 'VALID' AND issued_at IS NOT NULL AND number IS NOT NULL AND cuf IS NOT NULL ${inRange(Prisma.sql`issued_at`)}
        GROUP BY 1`,
      db.$queryRaw<{ period: string; total: Prisma.Decimal; credit: Prisma.Decimal; count: number }[]>`
        SELECT period, COUNT(*)::int AS count, COALESCE(SUM(total), 0) AS total, COALESCE(SUM(vat_credit), 0) AS credit
        FROM purchase_book_entries
        WHERE company_id = ${companyId}::uuid AND status = 'VALID' ${only ? Prisma.sql`AND period = ${only}` : Prisma.empty}
        GROUP BY 1`,
    ]);
    const result = new Map<string, BookTotals>();
    const at = (period: string) => {
      const known = result.get(period) ?? zeroTotals();
      result.set(period, known);
      return known;
    };
    for (const row of invoices) {
      const t = at(row.period);
      t.sales = t.sales.add(Decimal.of(row.total.toString()));
      t.salesCount = row.count;
      t.fiscalDebit = t.fiscalDebit.add(Decimal.of(row.debit.toString()));
    }
    for (const row of notes) {
      const t = at(row.period);
      t.sales = t.sales.sub(Decimal.of(row.total.toString()));
      t.fiscalDebit = t.fiscalDebit.sub(Decimal.of(row.debit.toString()));
    }
    for (const row of purchases) {
      const t = at(row.period);
      t.purchases = Decimal.of(row.total.toString());
      t.purchasesCount = row.count;
      t.vatCredit = Decimal.of(row.credit.toString());
    }
    return result;
  }

  private requirePeriod(period: string): void {
    if (!isVatBookPeriod(period)) throw invoicingErrors.invalidBookQuery('period', 'PERIOD_INVALID');
  }

  private company(): string {
    const id = this.cls.get('companyId');
    if (!id) throw new Error('No company in the request context');
    return id;
  }

  private user(): string | null {
    return this.cls.get('userId') ?? null;
  }

  private async permissions(): Promise<Set<string>> {
    const membershipId = this.cls.get('membershipId');
    return membershipId ? this.membership.permissions(membershipId) : new Set<string>();
  }
}
