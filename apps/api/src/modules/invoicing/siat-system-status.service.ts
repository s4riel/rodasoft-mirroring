import { Injectable } from '@nestjs/common';
import {
  type CodeHealth,
  codeHealth,
  laPazToday,
  type SiatBranchStatus,
  type SiatConnectionStatus,
  type SiatPointOfSaleStatus,
  type SiatSystemStatus,
  worstCodeHealth,
} from '@rodasoft/domain';
import { type SiatCuis, type SiatGateway, SiatUnavailableError } from '@rodasoft/siat';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../common/audit/audit.service';
import type { AppClsStore } from '../../common/cls';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettingsService } from '../../common/settings/settings.service';
import { SiatGatewayFactory } from '../../common/siat/siat-gateway.factory';
import { dayStart, nextDayStart } from '../inventory/business-days';
import { invoicingErrors } from './invoicing.errors';

interface PointOfSaleRow {
  id: string;
  code: number;
  name: string;
  cuis: string | null;
  cuisExpiresAt: Date | null;
  cufd: string | null;
  cufdExpiresAt: Date | null;
  lastSyncedAt: Date | null;
}

const latest = (dates: (Date | null)[]): Date | null => dates.reduce<Date | null>((max, date) => (date && (!max || date > max) ? date : max), null);

/**
 * The health of the SIAT link (HU-FAC-13): the connection as the last check saw it, and the CUIS and CUFD of every point of
 * sale by branch. A person can test the connection and renew the CUFD of a point of sale; both call the `SiatGateway` outside
 * any transaction. When the SIAT does not answer nothing is changed and the caller gets 503 `SIAT_UNAVAILABLE`.
 */
@Injectable()
export class SiatSystemStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly gateways: SiatGatewayFactory,
  ) {}

  async status(now = new Date()): Promise<SiatSystemStatus> {
    const companyId = this.cls.get('companyId') ?? '';
    const today = laPazToday(now);
    const [settings, warnHours, branches, issued, invoicesPending, notesPending] = await Promise.all([
      this.prisma.siatSettings.findUnique({ where: { companyId }, select: { connectionStatus: true, connectionCheckedAt: true, environment: true, modality: true } }),
      this.settings.get('invoicing.cufdWarnHours'),
      this.prisma.tenant.branch.findMany({
        where: { pointsOfSale: { some: {} } },
        orderBy: { code: 'asc' },
        select: {
          id: true,
          code: true,
          name: true,
          pointsOfSale: { orderBy: { code: 'asc' }, select: { id: true, code: true, name: true, cuis: true, cuisExpiresAt: true, cufd: true, cufdExpiresAt: true, lastSyncedAt: true } },
        },
      }),
      this.prisma.tenant.invoice.groupBy({
        by: ['pointOfSaleId'],
        where: { status: { in: ['VALID', 'CANCELLATION_PENDING'] }, issuedAt: { gte: dayStart(today), lt: nextDayStart(today) } },
        _count: true,
      }),
      this.prisma.tenant.invoice.count({ where: { status: 'PENDING' } }),
      this.prisma.tenant.creditNote.count({ where: { status: 'PENDING' } }),
    ]);
    const issuedToday = new Map(issued.map((row) => [row.pointOfSaleId, row._count]));

    const branchStatuses: SiatBranchStatus[] = branches.map((branch) => ({
      branchId: branch.id,
      branchCode: branch.code,
      branchName: branch.name,
      pointsOfSale: branch.pointsOfSale.map((point) => this.pointStatus(point, now, warnHours, issuedToday.get(point.id) ?? 0)),
    }));
    const points = branchStatuses.flatMap((branch) => branch.pointsOfSale);
    const health = (pick: (point: SiatPointOfSaleStatus) => CodeHealth) => worstCodeHealth(points.map(pick));
    return {
      connection: (settings?.connectionStatus ?? 'UNKNOWN') as SiatConnectionStatus,
      checkedAt: settings?.connectionCheckedAt?.toISOString() ?? null,
      environment: settings?.environment ?? 'TEST',
      modality: settings?.modality ?? 'ELECTRONIC_ONLINE',
      cuis: health((point) => point.cuis.health),
      cufd: health((point) => point.cufd.health),
      lastSyncedAt: latest(branches.flatMap((branch) => branch.pointsOfSale.map((point) => point.lastSyncedAt)))?.toISOString() ?? null,
      warnHours,
      notIssued: invoicesPending + notesPending,
      branches: branchStatuses,
    };
  }

  /** Asks the SIAT for a new CUFD of one point of sale (and its CUIS when it has none or it expired). */
  async renewCufd(pointOfSaleId: string): Promise<SiatPointOfSaleStatus> {
    const point = await this.prisma.tenant.siatPointOfSale.findFirst({
      where: { id: pointOfSaleId },
      select: { id: true, code: true, cuis: true, cuisExpiresAt: true, branch: { select: { code: true } } },
    });
    if (!point) throw invoicingErrors.pointOfSaleNotFound();
    const gateway = await this.gateways.forCurrentCompany();
    const ref = { branchCode: point.branch.code, pointOfSaleCode: point.code };
    const now = new Date();

    const { cuis, cufd } = await this.orUnavailable(async () => {
      // a CUFD is only handed out to a point of sale with a current CUIS
      const needsCuis = point.cuis === null || codeHealth(point.cuisExpiresAt, now, 0) === 'EXPIRED';
      const renewedCuis: SiatCuis | null = needsCuis ? await gateway.requestCuis(ref) : null;
      return { cuis: renewedCuis, cufd: await gateway.requestCufd(ref) };
    });

    const updated = await this.prisma.tenant.siatPointOfSale.update({
      where: { id: point.id },
      data: {
        cufd: cufd.code,
        cufdControlCode: cufd.controlCode,
        cufdAddress: cufd.address,
        cufdExpiresAt: cufd.expiresAt,
        lastSyncedAt: now,
        ...(cuis ? { cuis: cuis.code, cuisExpiresAt: cuis.expiresAt } : {}),
      },
      select: { id: true, code: true, name: true, cuis: true, cuisExpiresAt: true, cufd: true, cufdExpiresAt: true, lastSyncedAt: true },
    });
    // the codes themselves are not written to the audit log: only that they changed and until when they last
    await this.audit.log({
      action: 'invoicing.cufd.renew',
      entity: 'SiatPointOfSale',
      entityId: point.id,
      after: { cufdExpiresAt: cufd.expiresAt.toISOString(), cuisRenewed: cuis !== null },
    });
    const today = laPazToday(now);
    const issuedToday = await this.prisma.tenant.invoice.count({
      where: { pointOfSaleId: point.id, status: { in: ['VALID', 'CANCELLATION_PENDING'] }, issuedAt: { gte: dayStart(today), lt: nextDayStart(today) } },
    });
    return this.pointStatus(updated, now, await this.settings.get('invoicing.cufdWarnHours'), issuedToday);
  }

  /** Checks the SIAT now and records what it saw; an unreachable SIAT is recorded as `OFFLINE` and answered with 503. */
  async testConnection(): Promise<{ connection: SiatConnectionStatus; checkedAt: string }> {
    const companyId = this.cls.get('companyId') ?? '';
    let online: boolean;
    try {
      online = (await (await this.gateways.forCurrentCompany()).verifyCommunication()).success;
    } catch (error) {
      if (!(error instanceof SiatUnavailableError)) throw error;
      online = false;
    }
    const now = new Date();
    const status = online ? 'ONLINE' : 'OFFLINE';
    const previous = await this.prisma.siatSettings.findUnique({ where: { companyId }, select: { connectionStatus: true } });
    const changed = previous?.connectionStatus !== status;
    await this.prisma.siatSettings.upsert({
      where: { companyId },
      create: { companyId, connectionStatus: status, connectionCheckedAt: now, connectionChangedAt: now },
      update: { connectionStatus: status, connectionCheckedAt: now, ...(changed ? { connectionChangedAt: now } : {}) },
    });
    await this.audit.log({ action: 'invoicing.connection.test', entity: 'SiatSettings', entityId: companyId, before: { status: previous?.connectionStatus ?? 'UNKNOWN' }, after: { status } });
    if (!online) throw invoicingErrors.siatUnavailable();
    return { connection: status, checkedAt: now.toISOString() };
  }

  private async orUnavailable<T>(call: (gateway?: SiatGateway) => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof SiatUnavailableError) throw invoicingErrors.siatUnavailable();
      throw error;
    }
  }

  private pointStatus(point: PointOfSaleRow, now: Date, warnHours: number, issuedToday: number): SiatPointOfSaleStatus {
    return {
      id: point.id,
      code: point.code,
      name: point.name,
      cuis: { present: point.cuis !== null, expiresAt: point.cuisExpiresAt?.toISOString() ?? null, health: point.cuis === null ? 'EXPIRED' : codeHealth(point.cuisExpiresAt, now, warnHours) },
      cufd: { present: point.cufd !== null, expiresAt: point.cufdExpiresAt?.toISOString() ?? null, health: point.cufd === null ? 'EXPIRED' : codeHealth(point.cufdExpiresAt, now, warnHours) },
      lastSyncedAt: point.lastSyncedAt?.toISOString() ?? null,
      issuedToday,
    };
  }
}
