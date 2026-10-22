import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  clampPage,
  clampPageSize,
  parseMeasurement,
  type ProductFilterOptions,
  type ProductListItem,
  type ProductListResponse,
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
    const [total, anyProduct, rows] = await Promise.all([
      this.prisma.tenant.product.count({ where }),
      this.prisma.tenant.product.findFirst({ select: { id: true } }),
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
          brand: {
            select: { id: true, name: true, logoUrl: true, country: { select: { id: true, code: true, name: true } } },
          },
          category: { select: { id: true, name: true, parent: { select: { id: true, name: true } } } },
          dimensions: { select: { innerDiameter: true, outerDiameter: true, width: true } },
        },
      }),
    ]);

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
        country: r.brand.country,
        category: parent ? { id: parent.id, name: parent.name } : { id: r.category.id, name: r.category.name },
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

    return { items, page, pageSize, total, catalogEmpty: !anyProduct };
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
    if (q.countryId) and.push({ brand: { countryId: q.countryId } });
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
