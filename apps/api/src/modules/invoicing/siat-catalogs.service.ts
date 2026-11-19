import { Injectable } from '@nestjs/common';
import type { Prisma, SiatCatalog } from '@prisma/client';
import {
  type CatalogEntriesResponse,
  type CatalogSummary,
  clampPage,
  INVOICE_PAGE_SIZE_DEFAULT,
  INVOICE_PAGE_SIZE_MAX,
  isSiatCatalogKind,
  SIAT_CANCELLATION_REASONS,
  SIAT_CATALOGS,
  SIAT_CREDIT_NOTE_REASONS,
  type SiatCatalogKind,
} from '@rodasoft/domain';
import { SiatUnavailableError, type SiatCatalogs } from '@rodasoft/siat';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../common/audit/audit.service';
import type { AppClsStore } from '../../common/cls';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SiatGatewayFactory } from '../../common/siat/siat-gateway.factory';
import { invoicingErrors } from './invoicing.errors';

export interface SiatReason {
  code: number;
  description: string;
}

/**
 * The SIN parametric tables (HU-FAC-25): what was synced and when, their rows, and the sync itself. A sync fetches from the SIAT first
 * (outside any transaction), then replaces the rows in one transaction: rows the SIN no longer sends stay as inactive, so documents
 * issued with them keep their meaning. Offline: 503 and the old rows stay. Two syncs at once serialise on an advisory lock.
 */
@Injectable()
export class SiatCatalogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly audit: AuditService,
    private readonly gateways: SiatGatewayFactory,
  ) {}

  async summary(): Promise<CatalogSummary> {
    const [syncs, counts] = await Promise.all([
      this.prisma.tenant.siatCatalogSync.findMany({ select: { catalog: true, syncedAt: true, entryCount: true } }),
      this.prisma.tenant.siatCatalogEntry.groupBy({ by: ['catalog'], where: { active: true }, _count: true }),
    ]);
    const bySync = new Map(syncs.map((sync) => [sync.catalog, sync.syncedAt]));
    const byCount = new Map(counts.map((row) => [row.catalog, row._count]));
    const catalogs = SIAT_CATALOGS.map((catalog) => ({ catalog, entries: byCount.get(catalog) ?? 0, syncedAt: bySync.get(catalog)?.toISOString() ?? null }));
    const synced = catalogs.every((row) => row.syncedAt !== null);
    const latest = syncs.reduce<Date | null>((max, sync) => (!max || sync.syncedAt > max ? sync.syncedAt : max), null);
    return { catalogs, synced, syncedAt: synced ? (latest?.toISOString() ?? null) : null };
  }

  async entries(catalog: string, query: { q?: string; page?: number; pageSize?: number }): Promise<CatalogEntriesResponse> {
    if (!isSiatCatalogKind(catalog)) throw invoicingErrors.catalogNotFound();
    const q = query.q?.trim();
    const where: Prisma.SiatCatalogEntryWhereInput = {
      catalog,
      ...(q ? { OR: [{ code: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] } : {}),
    };
    const pageSize = Math.min(Math.max(query.pageSize ?? INVOICE_PAGE_SIZE_DEFAULT, 1), INVOICE_PAGE_SIZE_MAX);
    const total = await this.prisma.tenant.siatCatalogEntry.count({ where });
    const page = Math.min(clampPage(query.page), Math.max(1, Math.ceil(total / pageSize)));
    const [rows, sync] = await Promise.all([
      this.prisma.tenant.siatCatalogEntry.findMany({
        where,
        orderBy: [{ active: 'desc' }, { activityCode: 'asc' }, { code: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { code: true, description: true, activityCode: true, active: true },
      }),
      this.prisma.tenant.siatCatalogSync.findFirst({ where: { catalog }, select: { syncedAt: true } }),
    ]);
    return { catalog, syncedAt: sync?.syncedAt.toISOString() ?? null, items: rows, total, page, pageSize };
  }

  /** Reads every catalogue from the SIAT and replaces the rows. Needs an active point of sale to ask with. */
  async sync(now = new Date()): Promise<CatalogSummary> {
    const companyId = this.company();
    const point = await this.prisma.tenant.siatPointOfSale.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: [{ branch: { code: 'asc' } }, { code: 'asc' }],
      select: { code: true, branch: { select: { code: true } } },
    });
    if (!point) throw invoicingErrors.pointOfSaleMissing();
    const gateway = await this.gateways.forCurrentCompany();
    let fetched: SiatCatalogs;
    try {
      fetched = await gateway.syncCatalogs({ branchCode: point.branch.code, pointOfSaleCode: point.code });
    } catch (error) {
      if (error instanceof SiatUnavailableError) throw invoicingErrors.siatUnavailable();
      throw error;
    }

    const counts: Record<string, number> = {};
    await this.prisma.tenant.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`siat-catalog-sync:${companyId}`}))`;
        for (const catalog of SIAT_CATALOGS) {
          // a catalogue the SIAT did not send is left as it is: it is neither emptied nor stamped as synced
          const rows = fetched[catalog];
          if (!rows) continue;
          const incoming = new Map(rows.map((row) => [`${row.activityCode ?? ''}|${row.code}`, row]));
          const existing = await tx.siatCatalogEntry.findMany({ where: { catalog: catalog as SiatCatalog }, select: { id: true, code: true, activityCode: true, description: true, active: true } });
          const known = new Map(existing.map((row) => [`${row.activityCode}|${row.code}`, row]));

          const created = [...incoming].filter(([key]) => !known.has(key)).map(([, row]) => ({ companyId, catalog: catalog as SiatCatalog, code: row.code, description: row.description, activityCode: row.activityCode ?? '', active: true, syncedAt: now }));
          if (created.length > 0) await tx.siatCatalogEntry.createMany({ data: created });
          // only the rows that changed are updated one by one; the unchanged ones get their date in a single statement
          const unchanged: string[] = [];
          for (const [key, row] of incoming) {
            const old = known.get(key);
            if (!old) continue;
            if (old.description !== row.description || !old.active) {
              await tx.siatCatalogEntry.update({ where: { id: old.id }, data: { description: row.description, active: true, syncedAt: now } });
            } else {
              unchanged.push(old.id);
            }
          }
          if (unchanged.length > 0) await tx.siatCatalogEntry.updateMany({ where: { id: { in: unchanged } }, data: { syncedAt: now } });
          const gone = existing.filter((row) => !incoming.has(`${row.activityCode}|${row.code}`) && row.active).map((row) => row.id);
          if (gone.length > 0) await tx.siatCatalogEntry.updateMany({ where: { id: { in: gone } }, data: { active: false } });

          counts[catalog] = incoming.size;
          await tx.siatCatalogSync.upsert({
            where: { companyId_catalog: { companyId, catalog: catalog as SiatCatalog } },
            create: { companyId, catalog: catalog as SiatCatalog, syncedAt: now, entryCount: incoming.size },
            update: { syncedAt: now, entryCount: incoming.size },
          });
        }
        await this.audit.log({ action: 'invoicing.catalogs.sync', entity: 'SiatCatalog', entityId: companyId, after: { syncedAt: now.toISOString(), entries: counts } }, tx as unknown as Prisma.TransactionClient);
      },
      { timeout: 30_000 },
    );
    return this.summary();
  }

  /** The reasons the cancellation and credit-note dialogs offer: the synced catalogue, or the built-in lists before the first sync. */
  async reasons(): Promise<{ cancellation: SiatReason[]; creditNote: SiatReason[] }> {
    const [cancellation, creditNote] = await Promise.all([this.reasonsOf('CANCELLATION_REASON', SIAT_CANCELLATION_REASONS), this.reasonsOf('CREDIT_NOTE_REASON', SIAT_CREDIT_NOTE_REASONS)]);
    return { cancellation, creditNote };
  }

  async cancellationReasons(): Promise<SiatReason[]> {
    return this.reasonsOf('CANCELLATION_REASON', SIAT_CANCELLATION_REASONS);
  }

  async creditNoteReasons(): Promise<SiatReason[]> {
    return this.reasonsOf('CREDIT_NOTE_REASON', SIAT_CREDIT_NOTE_REASONS);
  }

  private async reasonsOf(catalog: SiatCatalogKind, fallback: readonly SiatReason[]): Promise<SiatReason[]> {
    const rows = await this.prisma.tenant.siatCatalogEntry.findMany({ where: { catalog: catalog as SiatCatalog, active: true }, select: { code: true, description: true } });
    const reasons = rows.map((row) => ({ code: Number(row.code), description: row.description })).filter((row) => Number.isInteger(row.code));
    return reasons.length > 0 ? reasons.sort((a, b) => a.code - b.code) : fallback.map((reason) => ({ ...reason }));
  }

  private company(): string {
    const id = this.cls.get('companyId');
    if (!id) throw new Error('No company in the request context');
    return id;
  }
}
