import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  Decimal,
  laPazToday,
  marginPercent,
  parsePrice,
  PRICE_PAGE_SIZE_DEFAULT,
  priceChangeDelta,
  validatePriceEdit,
  type EditPriceInput,
  type PriceChangeEntry,
  type PriceChangeSource,
  type PriceDetail,
  type PriceListKpis,
  type PriceListQuery,
  type PriceListResponse,
  type ProductStatus,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../../common/audit/audit.service';
import type { AppClsStore } from '../../../common/cls';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { MembershipService } from '../../access/membership.service';
import { productSearchWhere } from '../../inventory/product-search-where';
import { recordPriceChange } from '../../../common/prices/price-change.recorder';
import { priceErrors } from './prices.errors';

/** Changes the price dialog lists under the current price. */
const DETAIL_CHANGES = 10;

/** A draft of the creation wizard is not a product yet: it has no place in the price list. */
const LISTED: Prisma.ProductWhereInput = { status: { not: 'DRAFT' } };

type ChangeRow = {
  id: string;
  productId: string;
  oldPrice: Prisma.Decimal;
  newPrice: Prisma.Decimal;
  userId: string;
  source: string;
  reason: string | null;
  createdAt: Date;
};

/**
 * The price list and the price edit (HU-VEN-26, decision #18). There is one price per product and company,
 * `products.sale_price`: the POS, the quotes and the inventory sheet all read that column, so an edit here reaches them at once.
 * Every edit writes a `price_changes` row, the audit entry and the outbox event in the same transaction.
 *
 * The edit takes the product row `FOR UPDATE` and compares the price the editor saw (`expectedPrice`) with the stored one, so two
 * people editing the same product never overwrite each other in silence: the second gets `PRICE_CHANGED`.
 */
@Injectable()
export class PricesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly membership: MembershipService,
  ) {}

  /** VP-11 · products with their price, the stock of one branch and the last price change. */
  async list(query: PriceListQuery): Promise<PriceListResponse> {
    const db = this.prisma.tenant;
    const [branch, canViewCosts] = await Promise.all([this.resolveBranch(query.branchId), this.canViewCosts()]);
    const filters: Prisma.ProductWhereInput[] = [LISTED];
    if (query.q) filters.push(productSearchWhere(query.q).matching);
    if (query.brandId) filters.push({ brandId: query.brandId });
    // a category filter also matches the products of its subcategories
    if (query.categoryId) filters.push({ OR: [{ categoryId: query.categoryId }, { category: { parentId: query.categoryId } }] });
    if (query.priced === 'with') filters.push({ salePrice: { gt: 0 } });
    if (query.priced === 'without') filters.push({ salePrice: { equals: 0 } });
    const where: Prisma.ProductWhereInput = { AND: filters };
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? PRICE_PAGE_SIZE_DEFAULT;

    const [rows, total, kpis, brands, categories] = await Promise.all([
      db.product.findMany({
        where,
        orderBy: [{ manufacturerCode: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          sku: true,
          manufacturerCode: true,
          name: true,
          status: true,
          salePrice: true,
          photos: true,
          country: { select: { code: true, name: true } },
          brand: { select: { id: true, name: true, country: { select: { code: true, name: true } } } },
        },
      }),
      db.product.count({ where }),
      this.kpis(canViewCosts),
      db.brand.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      db.category.findMany({ where: { parentId: null }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, name: true } }),
    ]);

    const ids = rows.map((r) => r.id);
    const [stock, changes] = await Promise.all([
      branch
        ? db.stockLevel.groupBy({ by: ['productId'], where: { productId: { in: ids }, warehouse: { branchId: branch.id } }, _sum: { quantity: true } })
        : Promise.resolve([]),
      this.latestChanges(ids),
    ]);
    const stockByProduct = new Map(stock.map((s) => [s.productId, Number(s._sum.quantity ?? 0)]));
    const names = await this.userNames(changes.map((c) => c.userId));
    const lastChange = new Map(changes.map((c) => [c.productId, toEntry(c, names)]));

    return {
      items: rows.map((row) => {
        const photos = Array.isArray(row.photos) ? (row.photos as string[]) : [];
        return {
          productId: row.id,
          sku: row.sku,
          manufacturerCode: row.manufacturerCode,
          name: row.name,
          brand: { id: row.brand.id, name: row.brand.name },
          // the product's own industry wins; otherwise the country of its brand
          country: row.country ?? row.brand.country,
          photo: photos[0] ?? null,
          status: row.status as ProductStatus,
          salePrice: row.salePrice.toFixed(2),
          hasPrice: !row.salePrice.isZero(),
          branchStock: stockByProduct.get(row.id) ?? 0,
          lastChange: lastChange.get(row.id) ?? null,
        };
      }),
      total,
      page,
      pageSize,
      kpis,
      branch,
      brands,
      categories,
    };
  }

  /** VP-11b · the product with its current price and its last changes. */
  async detail(productId: string): Promise<PriceDetail> {
    const product = await this.prisma.tenant.product.findFirst({
      where: { id: productId, ...LISTED },
      select: { id: true, sku: true, manufacturerCode: true, name: true, salePrice: true, cost: true, brand: { select: { id: true, name: true } } },
    });
    if (!product) throw priceErrors.productNotFound();
    const [changes, canViewCosts] = await Promise.all([
      this.prisma.tenant.priceChange.findMany({ where: { productId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: DETAIL_CHANGES }),
      this.canViewCosts(),
    ]);
    const names = await this.userNames(changes.map((c) => c.userId));
    const salePrice = product.salePrice.toFixed(2);
    const cost = product.cost?.toFixed(4) ?? null;
    return {
      productId: product.id,
      sku: product.sku,
      manufacturerCode: product.manufacturerCode,
      name: product.name,
      brand: product.brand,
      salePrice,
      // never sent without the permission, not even as null
      ...(canViewCosts ? { cost, marginPercent: marginPercent(salePrice, cost) } : {}),
      changes: changes.map((c) => toEntry(c, names)),
    };
  }

  /** Changes the price of one product and records it. */
  async edit(productId: string, input: EditPriceInput): Promise<PriceDetail> {
    const expected = parsePrice(input.expectedPrice);
    if (!expected) throw priceErrors.invalidExpectedPrice();
    const wanted = parsePrice(input.newPrice);
    if (!wanted || wanted.isZero()) throw priceErrors.invalidPrice();
    const reason = input.reason?.trim() || null;
    const companyId = this.companyId();
    const userId = this.userId();
    const source: PriceChangeSource = 'MANUAL';

    await this.prisma.tenant.$transaction(async (tx) => {
      // the lock serializes edits of the same product: the second one reads the first one's price and is refused
      const rows = await tx.$queryRaw<{ sku: string; sale_price: string; status: string }[]>`
        SELECT sku, sale_price::text AS sale_price, status::text AS status
        FROM products WHERE id = ${productId}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;
      const stored = rows[0];
      if (!stored || stored.status === 'DRAFT') throw priceErrors.productNotFound();
      const oldPrice = Decimal.of(stored.sale_price).toString();
      if (!Decimal.of(oldPrice).eq(expected)) throw priceErrors.changed(oldPrice);
      const valid = validatePriceEdit(oldPrice, input.newPrice);
      if (!valid.ok) throw valid.error === 'PRICE_UNCHANGED' ? priceErrors.unchanged() : priceErrors.invalidPrice();
      const newPrice = valid.value.toString();

      await tx.product.updateMany({ where: { id: productId, companyId }, data: { salePrice: newPrice, updatedById: userId } });
      const change = await recordPriceChange(tx, { companyId, productId, oldPrice, newPrice, userId, source, reason });
      if (!change) throw priceErrors.unchanged();

      const delta = priceChangeDelta(oldPrice, newPrice);
      await this.audit.log(
        {
          action: 'sales.price.update',
          entity: 'Product',
          entityId: productId,
          before: { salePrice: oldPrice },
          after: { salePrice: newPrice, reason, source, priceChangeId: change.id },
        },
        tx as unknown as Prisma.TransactionClient,
      );
      await this.outbox.publish(
        'sales.price.changed',
        { productId, sku: stored.sku, oldPrice, newPrice, percent: delta.percent, source, reason, userId, priceChangeId: change.id },
        { tx, idempotencyKey: `price-changed:${change.id}` },
      );
    });
    return this.detail(productId);
  }

  /** The latest change of each product, read with `DISTINCT ON` so the history of a product is never loaded whole. */
  private async latestChanges(productIds: string[]) {
    if (productIds.length === 0) return [];
    const latest = await this.prisma.tenant.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT ON (product_id) id::text AS id
      FROM price_changes
      WHERE company_id = ${this.companyId()}::uuid AND product_id = ANY(${productIds}::uuid[])
      ORDER BY product_id, created_at DESC, id DESC`;
    return this.prisma.tenant.priceChange.findMany({ where: { id: { in: latest.map((row) => row.id) } } });
  }

  private async kpis(canViewCosts: boolean): Promise<PriceListKpis> {
    const db = this.prisma.tenant;
    const monthStart = new Date(`${laPazToday(new Date()).slice(0, 7)}-01T00:00:00-04:00`);
    const [products, withPrice, changesThisMonth, margin] = await Promise.all([
      db.product.count({ where: LISTED }),
      db.product.count({ where: { ...LISTED, salePrice: { gt: 0 } } }),
      db.priceChange.count({ where: { createdAt: { gte: monthStart } } }),
      canViewCosts ? this.averageMargin() : Promise.resolve(undefined),
    ]);
    return {
      products,
      withPrice,
      withoutPrice: products - withPrice,
      changesThisMonth,
      // omitted, not null, without `inventory.costs.view`
      ...(margin !== undefined ? { averageMarginPercent: margin } : {}),
    };
  }

  /** Mean of the margin over the sale price of the products that have both a price and a cost, with one decimal. */
  private async averageMargin(): Promise<string | null> {
    const rows = await this.prisma.tenant.$queryRaw<{ margin: string | null }[]>`
      SELECT round(avg((sale_price - cost) * 100 / sale_price), 1)::text AS margin
      FROM products
      WHERE company_id = ${this.companyId()}::uuid AND status <> 'DRAFT' AND sale_price > 0 AND cost IS NOT NULL`;
    return rows[0]?.margin ?? null;
  }

  /** The branch whose stock the list shows: the one asked for, or the first the caller operates. */
  private async resolveBranch(branchId: string | undefined): Promise<{ id: string; name: string } | null> {
    const allowed = await this.membership.operableBranchIds(this.cls.get('membershipId') ?? '');
    if (branchId) {
      const branch = await this.prisma.tenant.branch.findFirst({ where: { id: branchId }, select: { id: true, name: true } });
      if (!branch) throw priceErrors.invalidFilter('branchId');
      if (allowed && !allowed.includes(branch.id)) throw priceErrors.branchForbidden();
      return branch;
    }
    return this.prisma.tenant.branch.findFirst({
      where: { status: 'ACTIVE', ...(allowed ? { id: { in: allowed } } : {}) },
      orderBy: { code: 'asc' },
      select: { id: true, name: true },
    });
  }

  private async canViewCosts(): Promise<boolean> {
    return (await this.membership.permissions(this.cls.get('membershipId') ?? '')).has('inventory.costs.view');
  }

  private async userNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  private companyId(): string {
    const companyId = this.cls.get('companyId');
    if (!companyId) throw new Error('Prices outside a company context');
    return companyId;
  }

  private userId(): string {
    const userId = this.cls.get('userId');
    if (!userId) throw new Error('Prices outside a user context');
    return userId;
  }
}

function toEntry(change: ChangeRow, names: Map<string, string>): PriceChangeEntry {
  const oldPrice = change.oldPrice.toFixed(2);
  const newPrice = change.newPrice.toFixed(2);
  const name = names.get(change.userId);
  return {
    id: change.id,
    at: change.createdAt.toISOString(),
    by: name === undefined ? null : { id: change.userId, name },
    source: change.source as PriceChangeSource,
    oldPrice,
    newPrice,
    percent: priceChangeDelta(oldPrice, newPrice).percent,
    reason: change.reason,
  };
}
