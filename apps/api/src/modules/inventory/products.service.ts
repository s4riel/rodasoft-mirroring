import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  clampPage,
  clampPageSize,
  marginPercent,
  parseMeasurement,
  type ProductBranchStock,
  type ProductDetail,
  type ProductFilterOptions,
  type ProductListItem,
  type ProductListResponse,
  type ProductSpec,
  stockAvailability,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../../common/cls';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ListProductsQueryDto } from './dto';

/** Read side of the catalog (HU-INV-01). Never exposes `cost`. */
@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async list(query: ListProductsQueryDto): Promise<ProductListResponse> {
    const page = clampPage(query.page);
    const pageSize = clampPageSize(query.pageSize);
    if (query.branchId) await this.assertBranchAccess(query.branchId);

    const where = this.buildWhere(query);
    const [total, rows] = await Promise.all([
      this.prisma.tenant.product.count({ where }),
      this.prisma.tenant.product.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          sku: true,
          manufacturerCode: true,
          name: true,
          photos: true,
          salePrice: true,
          status: true,
          country: { select: { id: true, code: true, name: true } },
          brand: {
            select: { id: true, name: true, logoUrl: true, country: { select: { id: true, code: true, name: true } } },
          },
          category: {
            select: { id: true, name: true, icon: true, parent: { select: { id: true, name: true, icon: true } } },
          },
          dimensions: { select: { innerDiameter: true, outerDiameter: true, width: true } },
        },
      }),
    ]);

    // only an empty result can mean an empty catalog; otherwise the company has products
    const catalogEmpty = total === 0 && !(await this.prisma.tenant.product.findFirst({ select: { id: true } }));

    const ids = rows.map((r) => r.id);
    const [totals, branchTotals] = await Promise.all([
      this.prisma.tenant.stockLevel.groupBy({
        by: ['productId'],
        where: { productId: { in: ids } },
        _sum: { quantity: true },
      }),
      query.branchId
        ? this.prisma.tenant.stockLevel.groupBy({
            by: ['productId'],
            where: { productId: { in: ids }, warehouse: { branchId: query.branchId } },
            _sum: { quantity: true },
          })
        : Promise.resolve([]),
    ]);
    const totalByProduct = new Map(totals.map((t) => [t.productId, t._sum.quantity ?? 0]));
    const branchByProduct = new Map(branchTotals.map((t) => [t.productId, t._sum.quantity ?? 0]));

    const items: ProductListItem[] = rows.map((r) => {
      const photos = Array.isArray(r.photos) ? (r.photos as string[]) : [];
      const parent = r.category.parent;
      return {
        id: r.id,
        sku: r.sku,
        manufacturerCode: r.manufacturerCode,
        name: r.name,
        photoUrl: photos[0] ?? null,
        brand: { id: r.brand.id, name: r.brand.name, logoUrl: r.brand.logoUrl },
        country: r.country ?? r.brand.country,
        category: parent
          ? { id: parent.id, name: parent.name, icon: parent.icon }
          : { id: r.category.id, name: r.category.name, icon: r.category.icon },
        subcategory: parent ? { id: r.category.id, name: r.category.name } : null,
        dimensions: r.dimensions
          ? {
              innerDiameter: r.dimensions.innerDiameter?.toString() ?? null,
              outerDiameter: r.dimensions.outerDiameter?.toString() ?? null,
              width: r.dimensions.width?.toString() ?? null,
            }
          : null,
        totalStock: totalByProduct.get(r.id) ?? 0,
        branchStock: query.branchId ? (branchByProduct.get(r.id) ?? 0) : null,
        salePrice: r.salePrice.toFixed(2),
        status: r.status,
      };
    });

    return { items, page, pageSize, total, catalogEmpty };
  }

  /**
   * Product sheet (IN-02a). Stock per branch covers only the branches the member may operate; `cost` and
   * `marginPercent` are included only when `includeCost` (inventory.costs.view).
   */
  async detail(id: string, includeCost: boolean): Promise<ProductDetail> {
    const p = await this.prisma.tenant.product.findFirst({
      where: { id },
      include: {
        brand: {
          select: { id: true, name: true, logoUrl: true, country: { select: { id: true, code: true, name: true } } },
        },
        country: { select: { id: true, code: true, name: true } },
        category: {
          select: { id: true, name: true, icon: true, parent: { select: { id: true, name: true, icon: true } } },
        },
        dimensions: true,
      },
    });
    if (!p) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });

    const attributes = isRecord(p.attributes) ? p.attributes : {};
    const [specs, stockByBranch, actors] = await Promise.all([
      this.specsOf(p.categoryId, p.category.parent?.id ?? null, attributes),
      this.stockByBranch(id),
      // `User` is global (not tenant-scoped); the ids come from a product already loaded through `prisma.tenant`
      this.prisma.user.findMany({
        where: { id: { in: [p.createdById, p.updatedById].filter((v): v is string => !!v) } },
        select: { id: true, name: true },
      }),
    ]);
    const actor = (userId: string | null) => actors.find((a) => a.id === userId) ?? null;
    const parent = p.category.parent;
    const text = (key: string) => (typeof attributes[key] === 'string' ? (attributes[key] as string) : null);
    const cost = p.cost ? p.cost.toFixed(4) : null;
    const salePrice = p.salePrice.toFixed(2);

    return {
      id: p.id,
      sku: p.sku,
      manufacturerCode: p.manufacturerCode,
      name: p.name,
      unit: p.unit,
      status: p.status,
      brand: { id: p.brand.id, name: p.brand.name, logoUrl: p.brand.logoUrl },
      country: p.country ?? p.brand.country,
      category: parent
        ? { id: parent.id, name: parent.name, icon: parent.icon }
        : { id: p.category.id, name: p.category.name, icon: p.category.icon },
      subcategory: parent ? { id: p.category.id, name: p.category.name } : null,
      dimensions: p.dimensions
        ? {
            innerDiameter: p.dimensions.innerDiameter?.toString() ?? '',
            outerDiameter: p.dimensions.outerDiameter?.toString() ?? '',
            width: p.dimensions.width?.toString() ?? '',
            weight: p.dimensions.weight?.toString() ?? null,
          }
        : null,
      specs,
      extra: { tariffCode: text('tariffCode'), supplierName: text('supplierName'), sectors: text('sectors') },
      pricing: includeCost ? { salePrice, cost, marginPercent: marginPercent(salePrice, cost) } : { salePrice },
      // only the branches the member may see, so the total always matches the rows shown
      totalStock: stockByBranch.reduce((sum, b) => sum + b.quantity, 0),
      stockByBranch,
      photos: Array.isArray(p.photos) ? (p.photos as string[]) : [],
      datasheetUrl: p.datasheetUrl,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      createdBy: actor(p.createdById),
      updatedBy: actor(p.updatedById),
    };
  }

  /** The category's attribute definitions (the parent's when the subcategory has none), in definition order. */
  private async specsOf(categoryId: string, parentId: string | null, attributes: Record<string, unknown>) {
    const order = [{ step: 'asc' as const }, { sortOrder: 'asc' as const }, { key: 'asc' as const }];
    let defs = await this.prisma.tenant.attributeDefinition.findMany({ where: { categoryId }, orderBy: order });
    if (!defs.length && parentId) {
      defs = await this.prisma.tenant.attributeDefinition.findMany({ where: { categoryId: parentId }, orderBy: order });
    }
    return defs.map<ProductSpec>((d) => {
      const raw = attributes[d.key];
      const value = typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' ? raw : null;
      return { key: d.key, step: d.step, label: d.label, type: d.type, unit: d.unit, value };
    });
  }

  /** One row per branch the member may operate: quantity across its warehouses plus the branch thresholds. */
  private async stockByBranch(productId: string): Promise<ProductBranchStock[]> {
    const membership = await this.prisma.tenant.membership.findFirst({
      where: { id: this.cls.get('membershipId') ?? '' },
      select: { allBranches: true, branches: { select: { branchId: true } } },
    });
    const allowed = membership?.allBranches ? null : new Set(membership?.branches.map((b) => b.branchId) ?? []);
    const [branches, levels, thresholds] = await Promise.all([
      this.prisma.tenant.branch.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { code: 'asc' },
        select: {
          id: true,
          name: true,
          warehouses: { select: { id: true, name: true }, orderBy: { code: 'asc' } },
        },
      }),
      this.prisma.tenant.stockLevel.groupBy({ by: ['warehouseId'], where: { productId }, _sum: { quantity: true } }),
      this.prisma.tenant.stockThreshold.findMany({ where: { productId } }),
    ]);
    const byWarehouse = new Map(levels.map((l) => [l.warehouseId, l._sum.quantity ?? 0]));
    return branches
      .filter((b) => !allowed || allowed.has(b.id))
      .map((b) => {
        const quantity = b.warehouses.reduce((sum, w) => sum + (byWarehouse.get(w.id) ?? 0), 0);
        const t = thresholds.find((th) => th.branchId === b.id);
        return {
          branchId: b.id,
          branchName: b.name,
          warehouses: b.warehouses.map((w) => w.name),
          quantity,
          minStock: t?.minStock ?? null,
          maxStock: t?.maxStock ?? null,
          location: t?.location ?? null,
          availability: stockAvailability(quantity, t?.minStock ?? null),
        };
      });
  }

  async filterOptions(): Promise<ProductFilterOptions> {
    const [countries, brands, roots] = await Promise.all([
      this.prisma.tenant.country.findMany({ orderBy: { name: 'asc' }, select: { id: true, code: true, name: true } }),
      this.prisma.tenant.brand.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, logoUrl: true, countryId: true },
      }),
      this.prisma.tenant.category.findMany({
        where: { parentId: null, status: 'ACTIVE' },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          icon: true,
          children: {
            where: { status: 'ACTIVE' },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
            select: { id: true, name: true },
          },
        },
      }),
    ]);
    return {
      countries,
      brands,
      categories: roots.map((c) => ({ id: c.id, name: c.name, icon: c.icon, subcategories: c.children })),
    };
  }

  private buildWhere(q: ListProductsQueryDto): Prisma.ProductWhereInput {
    const and: Prisma.ProductWhereInput[] = [];
    // the product's own industry wins; products without one fall back to their brand's country
    if (q.countryId) {
      and.push({ OR: [{ countryId: q.countryId }, { countryId: null, brand: { countryId: q.countryId } }] });
    }
    if (q.brandId) and.push({ brandId: q.brandId });
    if (q.status) and.push({ status: q.status });
    // a root category also matches the products of its subcategories
    if (q.categoryId) and.push({ OR: [{ categoryId: q.categoryId }, { category: { parentId: q.categoryId } }] });
    if (q.subcategoryId) and.push({ categoryId: q.subcategoryId });
    const search = q.search?.trim();
    if (search) {
      const measurement = parseMeasurement(search);
      and.push({
        OR: [
          { manufacturerCode: { contains: search, mode: 'insensitive' } },
          { sku: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
          { brand: { name: { contains: search, mode: 'insensitive' } } },
          ...(measurement ? [{ dimensions: { is: measurement } }] : []),
        ],
      });
    }
    return and.length ? { AND: and } : {};
  }

  /** The branch must exist in the company and be one the member may operate. */
  private async assertBranchAccess(branchId: string) {
    const branch = await this.prisma.tenant.branch.findFirst({ where: { id: branchId }, select: { id: true } });
    if (!branch) throw new NotFoundException({ code: 'BRANCH_NOT_FOUND', message: 'Branch not found' });
    const membership = await this.prisma.tenant.membership.findFirst({
      where: { id: this.cls.get('membershipId') ?? '' },
      select: { allBranches: true, branches: { select: { branchId: true } } },
    });
    const allowed = membership?.allBranches || membership?.branches.some((b) => b.branchId === branchId);
    if (!allowed) {
      throw new ForbiddenException({ code: 'BRANCH_NOT_ALLOWED', message: 'You cannot operate this branch' });
    }
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
