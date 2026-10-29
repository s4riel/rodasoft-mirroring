import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  clampPage,
  clampPageSize,
  movementWindowStart,
  type ProductMovementItem,
  type ProductMovementsResponse,
  type ProductWarehouseStockResponse,
  stockAvailability,
  TRANSFER_IN_TRANSIT_STATUSES,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../../common/cls';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ListMovementsQueryDto } from './dto';

/**
 * Read side of stock (HU-INV-05): the movements tab and the stock per warehouse of the product sheet.
 * The kardex (HU-INV-24) is its own service, `KardexService`. This one never writes: stock changes only through the movements service.
 */
@Injectable()
export class StockQueriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  /** Movements newest first, with the balance after each one. `unit_cost` is never returned. */
  async movements(productId: string, query: ListMovementsQueryDto): Promise<ProductMovementsResponse> {
    await this.assertProduct(productId);
    const page = clampPage(query.page);
    const pageSize = clampPageSize(query.pageSize);
    const scope = await this.scope(query.branchId);
    const where: Prisma.StockMovementWhereInput = { productId, warehouse: scope };

    const windowStart = movementWindowStart(new Date(), query.days ?? 30);
    const [total, rows, inflow, outflow, balance] = await Promise.all([
      this.prisma.tenant.stockMovement.count({ where }),
      this.prisma.tenant.stockMovement.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          type: true,
          quantity: true,
          balanceAfter: true,
          refType: true,
          refNumber: true,
          createdAt: true,
          warehouse: { select: { id: true, name: true, branch: { select: { id: true, name: true } } } },
        },
      }),
      this.prisma.tenant.stockMovement.aggregate({
        where: { ...where, createdAt: { gte: windowStart }, quantity: { gt: 0 } },
        _sum: { quantity: true },
      }),
      this.prisma.tenant.stockMovement.aggregate({
        where: { ...where, createdAt: { gte: windowStart }, quantity: { lt: 0 } },
        _sum: { quantity: true },
      }),
      this.prisma.tenant.stockLevel.aggregate({
        where: { productId, warehouse: scope },
        _sum: { quantity: true },
      }),
    ]);

    const items: ProductMovementItem[] = rows.map((r) => ({
      id: r.id,
      date: r.createdAt.toISOString(),
      type: r.type,
      document: { refType: r.refType, refNumber: r.refNumber },
      quantity: r.quantity,
      balanceAfter: r.balanceAfter,
      branch: r.warehouse.branch,
      warehouse: { id: r.warehouse.id, name: r.warehouse.name },
    }));

    return {
      items,
      total,
      page,
      pageSize,
      summary: {
        inLast30Days: inflow._sum.quantity ?? 0,
        outLast30Days: Math.abs(outflow._sum.quantity ?? 0),
        currentBalance: balance._sum.quantity ?? 0,
      },
    };
  }

  /**
   * One row per warehouse that has a stock record or thresholds for the product (IN-23), in branch and
   * warehouse code order. Warehouses of branches the member may not operate are left out.
   */
  async stockByWarehouse(productId: string): Promise<ProductWarehouseStockResponse> {
    await this.assertProduct(productId);
    const inTransitByWarehouse = await this.inTransit(productId);
    const warehouses = await this.prisma.tenant.warehouse.findMany({
      where: {
        branch: { status: 'ACTIVE' },
        AND: [
          {
            OR: [
              { stockLevels: { some: { productId } } },
              { stockThresholds: { some: { productId } } },
              { id: { in: [...inTransitByWarehouse.keys()] } },
            ],
          },
          await this.scope(),
        ],
      },
      orderBy: [{ branch: { code: 'asc' } }, { code: 'asc' }],
      select: {
        id: true,
        name: true,
        branch: { select: { id: true, name: true } },
        stockLevels: { where: { productId }, select: { quantity: true } },
        stockThresholds: { where: { productId }, select: { minStock: true, maxStock: true, location: true } },
      },
    });

    const items = warehouses.map((w) => {
      const quantity = w.stockLevels[0]?.quantity ?? 0;
      const threshold = w.stockThresholds[0];
      const minStock = threshold?.minStock ?? null;
      return {
        branch: w.branch,
        warehouse: { id: w.id, name: w.name },
        location: threshold?.location ?? null,
        quantity,
        inTransit: inTransitByWarehouse.get(w.id) ?? 0,
        minStock,
        maxStock: threshold?.maxStock ?? null,
        availability: stockAvailability(quantity, minStock),
      };
    });
    return { items, total: items.reduce((sum, i) => sum + i.quantity, 0) };
  }

  /**
   * Pieces on their way to each destination warehouse: sent, not yet received. Derived from the transfer items (there is
   * no transit warehouse), so a receipt (HU-INV-21) lowers it by raising `receivedQuantity`.
   */
  private async inTransit(productId: string): Promise<Map<string, number>> {
    const items = await this.prisma.tenant.transferItem.findMany({
      where: { productId, transfer: { status: { in: [...TRANSFER_IN_TRANSIT_STATUSES] } } },
      select: { quantity: true, receivedQuantity: true, transfer: { select: { destinationWarehouseId: true } } },
    });
    const byWarehouse = new Map<string, number>();
    for (const item of items) {
      const pending = item.quantity - item.receivedQuantity;
      if (pending <= 0) continue;
      const warehouseId = item.transfer.destinationWarehouseId;
      byWarehouse.set(warehouseId, (byWarehouse.get(warehouseId) ?? 0) + pending);
    }
    return byWarehouse;
  }

  private async assertProduct(productId: string) {
    const product = await this.prisma.tenant.product.findFirst({ where: { id: productId }, select: { id: true } });
    if (!product) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });
  }

  /**
   * Warehouse filter for the member: the branch requested (must exist and be allowed), intersected with the
   * branches the member may operate. An empty filter means every branch.
   */
  private async scope(branchId?: string): Promise<Prisma.WarehouseWhereInput> {
    const membership = await this.prisma.tenant.membership.findFirst({
      where: { id: this.cls.get('membershipId') ?? '' },
      select: { allBranches: true, branches: { select: { branchId: true } } },
    });
    const allowed = membership?.allBranches ? null : (membership?.branches.map((b) => b.branchId) ?? []);

    if (branchId) {
      const branch = await this.prisma.tenant.branch.findFirst({ where: { id: branchId }, select: { id: true } });
      if (!branch) throw new NotFoundException({ code: 'BRANCH_NOT_FOUND', message: 'Branch not found' });
      if (allowed && !allowed.includes(branchId)) {
        throw new ForbiddenException({ code: 'BRANCH_NOT_ALLOWED', message: 'You cannot operate this branch' });
      }
      return { branchId };
    }
    return allowed ? { branchId: { in: allowed } } : {};
  }
}
