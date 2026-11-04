import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  availableQuantity,
  brandInitials,
  maxSellable,
  stockStatus,
  type PosCategoryListResponse,
  type PosProductResult,
  type PosProductSearchResponse,
} from '@rodasoft/domain';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SettingsService } from '../../../common/settings/settings.service';
import { codeRank, productSearchWhere } from '../../inventory/product-search-where';
import { CashShiftsService } from '../cash/cash-shifts.service';
import type { PosProductSearchQueryDto } from './pos.dto';

export const POS_SEARCH_LIMIT = 20;
/** The broad match is fetched wider than the limit: the exact and prefix codes are ranked first before cutting. */
const POS_MATCHING_FETCH_LIMIT = POS_SEARCH_LIMIT * 3;

/**
 * Search side of the POS (HU-VEN-02): the category chips and the product search with the stock of the warehouse of the
 * cashier's register. Never returns costs. Only reads stock.
 */
@Injectable()
export class PosCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shifts: CashShiftsService,
    private readonly settings: SettingsService,
  ) {}

  /** Active root categories, for the Todos / Rodamientos / Retenes / Correas chips. */
  async categories(): Promise<PosCategoryListResponse> {
    await this.shifts.requireOpenShift();
    const rows = await this.prisma.tenant.category.findMany({
      where: { parentId: null, status: 'ACTIVE' },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, icon: true },
    });
    return { items: rows };
  }

  /**
   * Active products matched by exact code first, then by code, SKU, name, brand or measurement. Without text, a category
   * lists its first products; without text nor category there is nothing to show.
   */
  async search(query: PosProductSearchQueryDto): Promise<PosProductSearchResponse> {
    const shift = await this.shifts.requireOpenShift();
    const search = query.q.trim();
    if (!search && !query.categoryId) return { items: [] };

    const warehouse = shift.warehouse;
    const allowNegative = await this.settings.get('inventory.allowNegativeStock');
    const select = {
      id: true,
      sku: true,
      manufacturerCode: true,
      name: true,
      salePrice: true,
      brand: { select: { name: true } },
      stockLevels: { where: { warehouseId: warehouse.id }, select: { quantity: true, reserved: true } },
      stockThresholds: { where: { warehouseId: warehouse.id }, select: { minStock: true } },
    } satisfies Prisma.ProductSelect;
    const base: Prisma.ProductWhereInput[] = [{ status: 'ACTIVE' }];
    if (query.categoryId) base.push({ OR: [{ categoryId: query.categoryId }, { category: { parentId: query.categoryId } }] });
    const orderBy: Prisma.ProductOrderByWithRelationInput[] = [{ manufacturerCode: 'asc' }, { id: 'asc' }];

    type Row = Prisma.ProductGetPayload<{ select: typeof select }>;
    let rows: Row[];
    if (search) {
      const where = productSearchWhere(search);
      const [exact, matching] = await Promise.all([
        this.prisma.tenant.product.findMany({ where: { AND: [...base, where.exact] }, orderBy, take: POS_SEARCH_LIMIT, select }),
        this.prisma.tenant.product.findMany({ where: { AND: [...base, where.matching] }, orderBy, take: POS_MATCHING_FETCH_LIMIT, select }),
      ]);
      rows = uniqueById([...exact, ...matching]).sort((a, b) => codeRank(a.manufacturerCode, search) - codeRank(b.manufacturerCode, search));
    } else {
      rows = await this.prisma.tenant.product.findMany({ where: { AND: base }, orderBy, take: POS_SEARCH_LIMIT, select });
    }

    const items = rows.slice(0, POS_SEARCH_LIMIT).map((p): PosProductResult => {
      const available = availableQuantity(p.stockLevels[0]);
      return {
        id: p.id,
        sku: p.sku,
        code: p.manufacturerCode,
        name: p.name,
        brand: { name: p.brand.name, initials: brandInitials(p.brand.name) },
        salePrice: p.salePrice.toFixed(2),
        available,
        stockStatus: stockStatus(available, p.stockThresholds[0]?.minStock ?? null),
        maxQuantity: maxSellable(available, allowNegative),
        warehouse: { id: warehouse.id, name: warehouse.name },
      };
    });
    return { items };
  }
}

/** Keeps the first row of each product (the exact-code query comes first). */
function uniqueById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}
