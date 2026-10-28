import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  canDeactivateWarehouse,
  clampPage,
  clampWarehousePageSize,
  type WarehouseDetail,
  type WarehouseListItem,
  type WarehouseListResponse,
  type WarehouseSaveResponse,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../common/audit/audit.service';
import type { AppClsStore } from '../../common/cls';
import { OutboxService } from '../../common/outbox/outbox.service';
import { PrismaService, type TenantTransaction } from '../../common/prisma/prisma.service';
import type { CreateWarehouseDto, ListWarehousesQueryDto, UpdateWarehouseDto } from './warehouses.dto';

const WITH_BRANCH = { branch: { select: { id: true, name: true } } } as const satisfies Prisma.WarehouseInclude;

type WarehouseRow = Prisma.WarehouseGetPayload<{ include: typeof WITH_BRANCH }>;

/**
 * Warehouses per branch (HU-INV-17): list, create and edit. Warehouses are never deleted, only deactivated, so the
 * kardex keeps its history. Every write runs in one transaction that first locks the branch row, which serializes the
 * "exactly one main warehouse per branch" swap; the partial unique index `warehouses_one_main_per_branch` is the safety
 * net behind that lock. Stock is read here but never written (design-notes rule 1).
 */
@Injectable()
export class WarehousesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async list(query: ListWarehousesQueryDto): Promise<WarehouseListResponse> {
    const page = clampPage(query.page);
    const pageSize = clampWarehousePageSize(query.pageSize);
    const allowed = await this.allowedBranchIds(this.prisma.tenant);

    const where = this.listFilter(query, allowed);

    const [total, rows] = await Promise.all([
      this.prisma.tenant.warehouse.count({ where }),
      this.prisma.tenant.warehouse.findMany({
        where,
        orderBy: [{ branch: { code: 'asc' } }, { code: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: WITH_BRANCH,
      }),
    ]);

    const stock = await this.prisma.tenant.stockLevel.groupBy({
      by: ['warehouseId'],
      where: { warehouseId: { in: rows.map((r) => r.id) }, quantity: { gt: 0 } },
      _sum: { quantity: true },
      _count: { _all: true },
    });
    const stockOf = new Map(stock.map((s) => [s.warehouseId, { products: s._count._all, units: s._sum.quantity ?? 0 }]));

    const items: WarehouseListItem[] = rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      branch: r.branch,
      isMain: r.isMain,
      visibleInStore: r.visibleInStore,
      status: r.status,
      productCount: stockOf.get(r.id)?.products ?? 0,
      totalUnits: stockOf.get(r.id)?.units ?? 0,
    }));
    return { items, total, page, pageSize };
  }

  private listFilter(query: ListWarehousesQueryDto, allowed: string[] | null): Prisma.WarehouseWhereInput {
    const conditions: Prisma.WarehouseWhereInput[] = [];
    if (query.branchId) {
      if (allowed && !allowed.includes(query.branchId)) throw this.branchForbidden();
      conditions.push({ branchId: query.branchId });
    } else if (allowed) {
      conditions.push({ branchId: { in: allowed } });
    }
    if (query.status) conditions.push({ status: query.status });
    const q = query.q?.trim();
    if (q) conditions.push({ OR: [{ code: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }] });
    return { AND: conditions };
  }

  async detail(id: string): Promise<WarehouseDetail> {
    const row = await this.prisma.tenant.warehouse.findFirst({ where: { id }, include: WITH_BRANCH });
    const allowed = await this.allowedBranchIds(this.prisma.tenant);
    // a warehouse of a branch the member may not operate does not exist for them
    if (!row || (allowed && !allowed.includes(row.branchId))) throw this.notFound();
    return this.toDetail(this.prisma.tenant, row);
  }

  async create(dto: CreateWarehouseDto): Promise<WarehouseSaveResponse> {
    const companyId = this.companyId();
    try {
      return await this.prisma.tenant.$transaction(async (tx) => {
        await this.assertBranchUsable(tx, dto.branchId);
        await this.lockBranches(tx, [dto.branchId]);

        const previousMain = await tx.warehouse.findFirst({
          where: { branchId: dto.branchId, isMain: true, status: 'ACTIVE' },
          select: { id: true, code: true },
        });
        // the first warehouse of a branch is its main one
        const isMain = dto.isMain === true || !previousMain;
        const demoted = isMain && previousMain ? previousMain : null;
        if (demoted) await tx.warehouse.update({ where: { id: demoted.id }, data: { isMain: false } });

        const created = await tx.warehouse.create({
          data: {
            companyId,
            branchId: dto.branchId,
            code: dto.code,
            name: dto.name,
            isMain,
            visibleInStore: dto.visibleInStore ?? true,
            locationNote: dto.locationNote ?? null,
          },
          include: WITH_BRANCH,
        });

        await this.audit.log(
          {
            action: 'inventory.warehouse.create',
            entity: 'Warehouse',
            entityId: created.id,
            after: this.snapshot(created),
          },
          tx as unknown as Prisma.TransactionClient,
        );
        await this.publishChanged(tx, created.id, created.status, created.visibleInStore);
        return { warehouse: await this.toDetail(tx, created), demotedMain: demoted };
      });
    } catch (err) {
      throw this.translate(err);
    }
  }

  async update(id: string, dto: UpdateWarehouseDto): Promise<WarehouseSaveResponse> {
    const companyId = this.companyId();
    try {
      return await this.prisma.tenant.$transaction(async (tx) => {
        const first = await tx.warehouse.findFirst({ where: { id }, select: { branchId: true } });
        const allowed = await this.allowedBranchIds(tx);
        // a warehouse of a branch the member may not operate does not exist for them
        if (!first || (allowed && !allowed.includes(first.branchId))) throw this.notFound();
        const targetBranchId = dto.branchId ?? first.branchId;
        // branches are locked before the warehouse row, always in id order, so concurrent edits cannot deadlock
        await this.lockBranches(tx, [first.branchId, targetBranchId]);
        await tx.$queryRaw`SELECT id FROM warehouses WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;
        const stored = await tx.warehouse.findFirst({ where: { id }, include: WITH_BRANCH });
        if (!stored) throw this.notFound();
        if (stored.branchId !== first.branchId) {
          // another edit moved the warehouse between the first read and the locks
          throw new ConflictException({ code: 'WAREHOUSE_MODIFIED', message: 'The warehouse was modified by someone else' });
        }

        if (dto.expectedUpdatedAt && new Date(dto.expectedUpdatedAt).getTime() !== stored.updatedAt.getTime()) {
          throw new ConflictException({
            code: 'WAREHOUSE_MODIFIED',
            message: 'The warehouse was modified by someone else',
            details: { updatedAt: stored.updatedAt.toISOString() },
          });
        }

        const branchChanged = targetBranchId !== stored.branchId;
        if (branchChanged) {
          await this.assertBranchUsable(tx, targetBranchId);
          if ((await tx.stockMovement.count({ where: { warehouseId: id } })) > 0) {
            throw new UnprocessableEntityException({
              code: 'WAREHOUSE_BRANCH_LOCKED',
              message: 'The branch cannot change: the warehouse has stock movements',
            });
          }
          if (stored.isMain) throw this.mainRequired();
        }

        const status = dto.status ?? stored.status;
        const reactivating = stored.status === 'INACTIVE' && status === 'ACTIVE';
        if (reactivating && !branchChanged) await this.assertBranchUsable(tx, stored.branchId);
        const deactivating = stored.status === 'ACTIVE' && status === 'INACTIVE';
        if (stored.isMain && dto.isMain === false) throw this.mainRequired();
        if (deactivating) {
          // any level that is not empty counts, negative ones and reservations included
          const levels = await tx.stockLevel.findMany({
            where: { warehouseId: id, OR: [{ quantity: { not: 0 } }, { reserved: { gt: 0 } }] },
            select: { quantity: true, reserved: true },
          });
          const totalUnits = levels.reduce((sum, l) => sum + Math.abs(l.quantity) + l.reserved, 0);
          const verdict = canDeactivateWarehouse({ totalUnits, isMain: stored.isMain });
          if (verdict === 'HAS_STOCK') {
            throw new UnprocessableEntityException({ code: 'WAREHOUSE_HAS_STOCK', message: 'The warehouse still has units in stock' });
          }
          if (verdict === 'MAIN_REQUIRED') throw this.mainRequired();
        }
        if (dto.isMain === true && status === 'INACTIVE') {
          throw new UnprocessableEntityException({ code: 'WAREHOUSE_MAIN_INACTIVE', message: 'An inactive warehouse cannot be the main one' });
        }

        // the flag is claimed again by a reactivated main, and by the first active warehouse of the target branch
        const activeInTarget = await tx.warehouse.count({ where: { branchId: targetBranchId, status: 'ACTIVE', id: { not: id } } });
        let isMain = stored.isMain;
        if (dto.isMain === true) isMain = true;
        else if (branchChanged && status === 'ACTIVE' && activeInTarget === 0) isMain = true;
        const claimsMain = isMain && (!stored.isMain || reactivating || branchChanged);

        let demoted: { id: string; code: string } | null = null;
        if (claimsMain) {
          demoted = await tx.warehouse.findFirst({
            where: { branchId: targetBranchId, isMain: true, status: 'ACTIVE', id: { not: id } },
            select: { id: true, code: true },
          });
          if (demoted) await tx.warehouse.update({ where: { id: demoted.id }, data: { isMain: false } });
        }

        const data: Prisma.WarehouseUpdateInput = {
          ...(dto.code !== undefined && { code: dto.code }),
          ...(dto.name !== undefined && { name: dto.name }),
          ...(branchChanged && { branch: { connect: { id: targetBranchId } } }),
          ...(dto.visibleInStore !== undefined && { visibleInStore: dto.visibleInStore }),
          ...(dto.locationNote !== undefined && { locationNote: dto.locationNote }),
          status,
          isMain,
        };
        const updated = await tx.warehouse.update({ where: { id }, data, include: WITH_BRANCH });

        const before = this.snapshot(stored);
        const after = this.snapshot(updated);
        const changed = (Object.keys(after) as (keyof typeof after)[]).filter((k) => before[k] !== after[k]);
        await this.audit.log(
          {
            action: 'inventory.warehouse.update',
            entity: 'Warehouse',
            entityId: id,
            before: Object.fromEntries(changed.map((k) => [k, before[k]])),
            after: { ...Object.fromEntries(changed.map((k) => [k, after[k]])), ...(demoted && { demotedMainId: demoted.id }) },
          },
          tx as unknown as Prisma.TransactionClient,
        );
        if (updated.status !== stored.status || updated.visibleInStore !== stored.visibleInStore) {
          await this.publishChanged(tx, id, updated.status, updated.visibleInStore);
        }
        return { warehouse: await this.toDetail(tx, updated), demotedMain: demoted };
      });
    } catch (err) {
      throw this.translate(err);
    }
  }

  private snapshot(w: WarehouseRow) {
    return {
      code: w.code,
      name: w.name,
      branchId: w.branchId,
      isMain: w.isMain,
      visibleInStore: w.visibleInStore,
      locationNote: w.locationNote,
      status: w.status,
    };
  }

  private async toDetail(tx: TenantTransaction | PrismaService['tenant'], w: WarehouseRow): Promise<WarehouseDetail> {
    const [movements, totals] = await Promise.all([
      tx.stockMovement.count({ where: { warehouseId: w.id } }),
      tx.stockLevel.aggregate({ where: { warehouseId: w.id, quantity: { gt: 0 } }, _sum: { quantity: true } }),
    ]);
    return {
      id: w.id,
      code: w.code,
      name: w.name,
      branch: w.branch,
      isMain: w.isMain,
      visibleInStore: w.visibleInStore,
      locationNote: w.locationNote,
      status: w.status,
      updatedAt: w.updatedAt.toISOString(),
      hasMovements: movements > 0,
      totalUnits: totals._sum.quantity ?? 0,
    };
  }

  /** The store sells only from published, active warehouses, so it listens to these two fields. */
  private async publishChanged(tx: TenantTransaction, warehouseId: string, status: string, visibleInStore: boolean) {
    await this.outbox.publish(
      'inventory.warehouse.changed',
      { warehouseId, status, visibleInStore, userId: this.cls.get('userId') ?? null },
      { tx, companyId: this.companyId() },
    );
  }

  /** Locks the branch rows in id order: every warehouse write of a branch runs one after the other. */
  private async lockBranches(tx: TenantTransaction, branchIds: string[]): Promise<void> {
    const companyId = this.companyId();
    const ids = [...new Set(branchIds)].sort();
    for (const branchId of ids) {
      await tx.$queryRaw`SELECT id FROM branches WHERE id = ${branchId}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;
    }
  }

  /** The branch must exist in the company and be active. */
  private async assertBranchUsable(tx: TenantTransaction, branchId: string): Promise<void> {
    const branch = await tx.branch.findFirst({ where: { id: branchId }, select: { status: true } });
    if (!branch || branch.status !== 'ACTIVE') {
      throw new UnprocessableEntityException({ code: 'BRANCH_INVALID', message: 'The branch does not exist or is inactive' });
    }
    await this.assertOperable(tx, branchId);
  }

  /** Forbidden unless the member may operate the branch; an unknown warehouse is a 404. */
  private async assertOperable(tx: TenantTransaction, branchId: string | undefined): Promise<void> {
    if (!branchId) throw this.notFound();
    const allowed = await this.allowedBranchIds(tx);
    if (allowed && !allowed.includes(branchId)) throw this.branchForbidden();
  }

  /** Branch ids the member may operate; `null` means every branch. */
  private async allowedBranchIds(db: TenantTransaction | PrismaService['tenant']): Promise<string[] | null> {
    const membership = await db.membership.findFirst({
      where: { id: this.cls.get('membershipId') ?? '' },
      select: { allBranches: true, branches: { select: { branchId: true } } },
    });
    return membership?.allBranches ? null : (membership?.branches.map((b) => b.branchId) ?? []);
  }

  private translate(err: unknown): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException({ code: 'WAREHOUSE_CODE_EXISTS', message: 'A warehouse with this code already exists' });
    }
    return err;
  }

  private mainRequired() {
    return new UnprocessableEntityException({
      code: 'WAREHOUSE_MAIN_REQUIRED',
      message: 'The main warehouse of a branch cannot be unset or deactivated: set another one as main first',
    });
  }

  private branchForbidden() {
    return new ForbiddenException({ code: 'BRANCH_FORBIDDEN', message: 'You cannot operate this branch' });
  }

  private notFound() {
    return new NotFoundException({ code: 'WAREHOUSE_NOT_FOUND', message: 'Warehouse not found' });
  }

  private companyId(): string {
    const companyId = this.cls.get('companyId');
    if (!companyId) throw new Error('Warehouses outside a company context');
    return companyId;
  }
}
