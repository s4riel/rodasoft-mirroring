import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type CreatePointOfSaleInput, codeHealth, POINT_OF_SALE_TYPES_DEFAULT, type PointOfSaleListItem, type PointOfSaleListResponse } from '@rodasoft/domain';
import { SiatUnavailableError } from '@rodasoft/siat';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../common/audit/audit.service';
import type { AppClsStore } from '../../common/cls';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SiatGatewayFactory } from '../../common/siat/siat-gateway.factory';
import { invoicingErrors } from './invoicing.errors';

/**
 * The points of sale of the company (HU-FAC-24): the list with its cash register, last invoice and CUIS, registering a new one in
 * the SIAT and closing one. The SIAT is called outside any transaction; when it does not answer nothing is saved (503). A point of
 * sale that issued invoices is deactivated, never deleted.
 */
@Injectable()
export class PointsOfSaleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly audit: AuditService,
    private readonly gateways: SiatGatewayFactory,
  ) {}

  async list(now = new Date()): Promise<PointOfSaleListResponse> {
    const [points, lastInvoices, types] = await Promise.all([
      this.prisma.tenant.siatPointOfSale.findMany({
        orderBy: [{ branch: { code: 'asc' } }, { code: 'asc' }],
        select: { id: true, branchId: true, code: true, name: true, typeCode: true, cuis: true, cuisExpiresAt: true, status: true, branch: { select: { name: true } }, cashRegister: { select: { name: true } } },
      }),
      this.prisma.tenant.invoice.groupBy({ by: ['pointOfSaleId'], where: { number: { not: null }, pointOfSaleId: { not: null } }, _max: { number: true } }),
      this.types(),
    ]);
    const last = new Map(lastInvoices.map((row) => [row.pointOfSaleId, row._max.number]));
    const items = points.map(
      (point): PointOfSaleListItem => ({
        id: point.id,
        branchId: point.branchId,
        branchName: point.branch.name,
        code: point.code,
        name: point.name,
        typeCode: point.typeCode,
        registerName: point.cashRegister?.name ?? null,
        lastInvoiceNumber: last.get(point.id) ?? null,
        cuisHealth: point.cuis === null ? 'EXPIRED' : codeHealth(point.cuisExpiresAt, now, 0),
        cuisExpiresAt: point.cuisExpiresAt?.toISOString() ?? null,
        status: point.status,
      }),
    );
    const active = items.filter((item) => item.status === 'ACTIVE');
    return { items, kpis: { total: items.length, active: active.length, withoutCuis: active.filter((item) => item.cuisHealth === 'EXPIRED').length }, types };
  }

  /** Registers the point of sale in the SIN, asks its CUIS and saves it with its cash register. 503 and nothing saved when the SIAT is offline. */
  async create(input: CreatePointOfSaleInput, now = new Date()): Promise<PointOfSaleListItem> {
    const companyId = this.company();
    const name = input.name.trim();
    const branch = await this.prisma.tenant.branch.findFirst({ where: { id: input.branchId, status: 'ACTIVE' }, select: { id: true, code: true, name: true } });
    if (!branch) throw invoicingErrors.branchNotFound();
    const warehouse = await this.prisma.tenant.warehouse.findFirst({ where: { id: input.warehouseId, branchId: branch.id, status: 'ACTIVE' }, select: { id: true } });
    if (!warehouse) throw invoicingErrors.warehouseNotFound();
    if (!(await this.types()).some((type) => type.code === input.typeCode)) throw invoicingErrors.invalidNote([{ field: 'typeCode', error: 'TYPE_INVALID' }]);

    const known = await this.prisma.tenant.siatPointOfSale.findMany({ where: { branchId: branch.id }, select: { code: true } });
    const gateway = await this.gateways.forCurrentCompany();
    let registered: { code: number };
    let cuis: { code: string; expiresAt: Date };
    try {
      registered = await gateway.registerPointOfSale({ branchCode: branch.code, name, typeCode: input.typeCode, knownCodes: known.map((point) => point.code) });
      cuis = await gateway.requestCuis({ branchCode: branch.code, pointOfSaleCode: registered.code });
    } catch (error) {
      if (error instanceof SiatUnavailableError) throw invoicingErrors.siatUnavailable();
      throw error;
    }

    const created = await this.prisma.tenant
      .$transaction(async (tx) => {
        const point = await tx.siatPointOfSale.create({
          data: { companyId, branchId: branch.id, code: registered.code, name, typeCode: input.typeCode, cuis: cuis.code, cuisExpiresAt: cuis.expiresAt, lastSyncedAt: now },
          select: { id: true },
        });
        const register = await tx.cashRegister.create({
          data: { companyId, branchId: branch.id, pointOfSaleId: point.id, warehouseId: warehouse.id, name, status: 'ACTIVE' },
          select: { id: true },
        });
        await this.audit.log(
          {
            action: 'invoicing.point-of-sale.create',
            entity: 'SiatPointOfSale',
            entityId: point.id,
            // the CUIS itself is a credential: only that it was obtained
            after: { branchId: branch.id, code: registered.code, name, typeCode: input.typeCode, registerId: register.id, cuisExpiresAt: cuis.expiresAt.toISOString() },
          },
          tx as unknown as Prisma.TransactionClient,
        );
        return point;
      })
      .catch((error: unknown) => {
        // the SIN gave a code the company already holds (the same name asked twice at once)
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw invoicingErrors.pointOfSaleExists();
        throw error;
      });
    return (await this.list(now)).items.find((item) => item.id === created.id) as PointOfSaleListItem;
  }

  /** Closes the point of sale in the SIN and deactivates it with its register; refused while its register has an open shift. */
  async deactivate(id: string): Promise<PointOfSaleListItem> {
    const point = await this.prisma.tenant.siatPointOfSale.findFirst({ where: { id }, select: { id: true, code: true, status: true, branch: { select: { code: true } } } });
    if (!point) throw invoicingErrors.pointOfSaleNotFound();
    if (point.status !== 'ACTIVE') throw invoicingErrors.pointOfSaleInactive();

    // 1. under the register lock: no open shift, and the register stops taking new ones, before the SIAT is called
    await this.prisma.tenant.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM cash_registers WHERE point_of_sale_id = ${id}::uuid FOR UPDATE`;
      if (await this.hasOpenShift(tx, id)) throw invoicingErrors.pointOfSaleInUse();
      await tx.cashRegister.updateMany({ where: { pointOfSaleId: id }, data: { status: 'INACTIVE' } });
    });

    // 2. the SIAT closes it; when it does not, the register goes back to active
    try {
      const gateway = await this.gateways.forCurrentCompany();
      await gateway.closePointOfSale({ branchCode: point.branch.code, pointOfSaleCode: point.code });
    } catch (error) {
      await this.prisma.tenant.cashRegister.updateMany({ where: { pointOfSaleId: id }, data: { status: 'ACTIVE' } });
      if (error instanceof SiatUnavailableError) throw invoicingErrors.siatUnavailable();
      throw error;
    }

    const now = new Date();
    await this.prisma.tenant.$transaction(async (tx) => {
      await tx.siatPointOfSale.update({ where: { id }, data: { status: 'INACTIVE', deactivatedAt: now } });
      await this.audit.log(
        { action: 'invoicing.point-of-sale.deactivate', entity: 'SiatPointOfSale', entityId: id, before: { status: 'ACTIVE' }, after: { status: 'INACTIVE' } },
        tx as unknown as Prisma.TransactionClient,
      );
    });
    return (await this.list(now)).items.find((item) => item.id === id) as PointOfSaleListItem;
  }

  /** The point-of-sale types the form offers: the synced catalogue, or the two built-in ones before the first sync. */
  private async types(): Promise<{ code: number; description: string }[]> {
    const rows = await this.prisma.tenant.siatCatalogEntry.findMany({ where: { catalog: 'POINT_OF_SALE_TYPE', active: true }, orderBy: { code: 'asc' }, select: { code: true, description: true } });
    const synced = rows.map((row) => ({ code: Number(row.code), description: row.description })).filter((row) => Number.isInteger(row.code));
    return synced.length > 0 ? synced.sort((a, b) => a.code - b.code) : POINT_OF_SALE_TYPES_DEFAULT.map((type) => ({ ...type }));
  }

  private async hasOpenShift(db: Pick<PrismaService['tenant'], 'cashShift'>, pointOfSaleId: string): Promise<boolean> {
    return (await db.cashShift.count({ where: { status: 'OPEN', register: { pointOfSaleId } } })) > 0;
  }

  private company(): string {
    const id = this.cls.get('companyId');
    if (!id) throw new Error('No company in the request context');
    return id;
  }
}
