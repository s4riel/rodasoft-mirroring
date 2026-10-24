import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  clampPage,
  type CategoryAttributeDefinitionsResponse,
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
  summarizeSpecs,
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
          dimensions: { select: { innerDiameter: true, outerDiameter: true, width: true, weight: true } },
          attributes: true,
        },
      }),
    ]);

    // technical fields for the description: one query for the definitions of every category on the page
    const categoryIds = [...new Set(rows.flatMap((r) => [r.category.id, r.category.parent?.id ?? '']).filter(Boolean))];
    const definitions = categoryIds.length
      ? await this.prisma.tenant.attributeDefinition.findMany({
          where: { categoryId: { in: categoryIds } },
          orderBy: [{ step: 'asc' }, { sortOrder: 'asc' }, { key: 'asc' }],
          select: { categoryId: true, key: true, label: true, type: true, unit: true },
        })
      : [];
    const definitionsOf = (categoryId: string) => definitions.filter((d) => d.categoryId === categoryId);

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
              weight: r.dimensions.weight?.toString() ?? null,
            }
          : null,
        // the subcategory's own fields, or its parent's when it has none (same rule as the product sheet)
        specs: summarizeSpecs(
          definitionsOf(r.category.id).length ? definitionsOf(r.category.id) : parent ? definitionsOf(parent.id) : [],
          isRecord(r.attributes) ? r.attributes : {},
          { hasMeasures: !!(r.dimensions?.innerDiameter && r.dimensions.outerDiameter && r.dimensions.width) },
        ),
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
      extra: { tariffCode: p.tariffCode, supplierName: p.supplierName, sectors: p.sectors.length ? p.sectors.join(', ') : null },
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
      this.prisma.tenant.stockThreshold.findMany({ where: { productId }, select: { minStock: true, maxStock: true, location: true, warehouse: { select: { branchId: true, isMain: true } } } }),
    ]);
    const byWarehouse = new Map(levels.map((l) => [l.warehouseId, l._sum.quantity ?? 0]));
    return branches
      .filter((b) => !allowed || allowed.has(b.id))
      .map((b) => {
        const quantity = b.warehouses.reduce((sum, w) => sum + (byWarehouse.get(w.id) ?? 0), 0);
        // thresholds are per warehouse (HU-INV-05): the branch sums them, and its location is the main warehouse's
        const own = thresholds.filter((th) => th.warehouse.branchId === b.id);
        const minStock = sumOrNull(own.map((th) => th.minStock));
        const maxStock = sumOrNull(own.map((th) => th.maxStock));
        return {
          branchId: b.id,
          branchName: b.name,
          warehouses: b.warehouses.map((w) => w.name),
          quantity,
          minStock,
          maxStock,
          location: own.find((th) => th.warehouse.isMain)?.location ?? null,
          availability: stockAvailability(quantity, minStock),
        };
      });
  }

  /** Technical fields of a category for the wizard (HU-INV-06): its own definitions, else its parent's. */
  async attributeDefinitions(categoryId: string): Promise<CategoryAttributeDefinitionsResponse> {
    const category = await this.prisma.tenant.category.findFirst({ where: { id: categoryId }, select: { id: true, parentId: true } });
    if (!category) throw new NotFoundException({ code: 'CATEGORY_NOT_FOUND', message: 'Category not found' });

    const order = [{ step: 'asc' as const }, { sortOrder: 'asc' as const }];
    let definedOn = category.id;
    let defs = await this.prisma.tenant.attributeDefinition.findMany({ where: { categoryId }, orderBy: order });
    if (!defs.length && category.parentId) {
      definedOn = category.parentId;
      defs = await this.prisma.tenant.attributeDefinition.findMany({ where: { categoryId: category.parentId }, orderBy: order });
    }
    return {
      categoryId,
      definedOn,
      items: defs.map((d) => ({
        key: d.key,
        label: d.label,
        type: d.type,
        unit: d.unit,
        options: Array.isArray(d.options) ? (d.options as string[]) : null,
        required: d.required,
        step: d.step,
        sortOrder: d.sortOrder,
      })),
    };
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
    // drafts (HU-INV-06) stay out of the list unless filtered for; `status` is only ACTIVE or INACTIVE in the filter
    and.push({ status: q.status ?? { not: 'DRAFT' } });
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

/** Sum of the set values; null when none of them is set. */
function sumOrNull(values: (number | null)[]): number | null {
  const set = values.filter((v): v is number => v !== null);
  return set.length ? set.reduce((sum, v) => sum + v, 0) : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
