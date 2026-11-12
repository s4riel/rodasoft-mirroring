import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  applyBulkAdjustment,
  BULK_PRICE_MAX_PRODUCTS,
  Decimal,
  PRICE_PAGE_SIZE_DEFAULT,
  priceChangeDelta,
  validateBulkAdjustment,
  type BulkAdjustment,
  type BulkPriceApplyInput,
  type BulkPriceInput,
  type BulkPricePreview,
  type BulkPricePreviewRow,
  type BulkPriceResult,
} from '@rodasoft/domain';
import { createHash, randomUUID } from 'node:crypto';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../../common/audit/audit.service';
import type { AppClsStore } from '../../../common/cls';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { recordPriceChanges } from '../../../common/prices/price-change.recorder';
import { PrismaService, type TenantTransaction } from '../../../common/prisma/prisma.service';
import { SettingsService } from '../../../common/settings/settings.service';
import { brandCategoryFilters, LISTED } from './price-filter';
import { priceErrors } from './prices.errors';

/** One transaction locks every matching product row (up to the cap) and writes as many history rows. */
const APPLY_TRANSACTION_OPTIONS = { timeout: 120_000, maxWait: 30_000 } as const;

interface Filter {
  brandId?: string;
  categoryId?: string;
}

interface Outcome {
  productId: string;
  current: Decimal;
  /** Null when the row does not change. */
  next: Decimal | null;
  status: BulkPricePreviewRow['status'];
}

/** What a filter and an adjustment would do to the prices at this moment. */
interface Plan {
  outcomes: Outcome[];
  changes: { productId: string; oldPrice: string; newPrice: string }[];
  hash: string;
}

/**
 * The bulk price update by brand or category (HU-VEN-27, VP-11c; decision #19: no approval unless the company turns it on).
 *
 * The preview reads and writes nothing else. The apply takes every matching product row `FOR UPDATE` in id order, so a single
 * edit (HU-VEN-26) of one of them waits for it and then finds a price it did not expect (`PRICE_CHANGED`), and two bulk updates
 * of the company run one after the other (advisory lock). Inside the lock it works out the new prices again and compares the hash
 * of what it would write with the hash of the preview the user saw: if a price was edited or a product added meanwhile, nothing
 * is written (`BULK_PREVIEW_STALE`). The products, the `price_changes` rows (one `batch_id`), the audit entry and the outbox event
 * are one transaction. Nothing is stored for the batch itself: its header lives in the audit entry and the event.
 */
@Injectable()
export class PriceBulkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsService,
  ) {}

  /** What the update would do, paginated, with the hash `apply` will ask for. Writes nothing. */
  async preview(input: BulkPriceInput): Promise<BulkPricePreview> {
    const adjustment = this.adjustmentOf(input);
    await this.checkFilter(input);
    const [defaultRounding, requiresApproval] = await Promise.all([
      this.settings.get('sales.roundingMode'),
      this.settings.get('sales.bulkPriceRequiresApproval'),
    ]);
    const where: Prisma.ProductWhereInput = { AND: [LISTED, ...brandCategoryFilters(input)] };
    const matched = await this.prisma.tenant.product.count({ where });
    if (matched > BULK_PRICE_MAX_PRODUCTS) throw priceErrors.tooManyProducts(matched, BULK_PRICE_MAX_PRODUCTS);

    const products = await this.prisma.tenant.product.findMany({
      where,
      orderBy: [{ manufacturerCode: 'asc' }, { id: 'asc' }],
      select: { id: true, sku: true, manufacturerCode: true, name: true, salePrice: true, brand: { select: { id: true, name: true } } },
    });
    const plan = this.plan(
      products.map((p) => ({ id: p.id, price: p.salePrice.toFixed(2) })),
      adjustment,
    );

    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? PRICE_PAGE_SIZE_DEFAULT;
    const start = (page - 1) * pageSize;
    const items = products.slice(start, start + pageSize).map((product, index): BulkPricePreviewRow => {
      const outcome = plan.outcomes[start + index];
      const currentPrice = outcome.current.toString();
      return {
        productId: product.id,
        sku: product.sku,
        manufacturerCode: product.manufacturerCode,
        name: product.name,
        brand: product.brand,
        currentPrice,
        newPrice: outcome.next?.toString() ?? null,
        percent: outcome.next ? priceChangeDelta(currentPrice, outcome.next.toString()).percent : null,
        status: outcome.status,
      };
    });

    return {
      counts: {
        matched,
        toChange: plan.changes.length,
        unchanged: plan.outcomes.filter((o) => o.status === 'UNCHANGED').length,
        invalid: plan.outcomes.filter((o) => o.status === 'INVALID').length,
      },
      items,
      page,
      pageSize,
      previewHash: plan.hash,
      defaultRounding,
      requiresApproval,
    };
  }

  /** Writes the update the user previewed, or nothing at all. */
  async apply(input: BulkPriceApplyInput): Promise<BulkPriceResult> {
    const adjustment = this.adjustmentOf(input);
    const filter = await this.checkFilter(input);
    const reason = input.reason?.trim() || null;
    const companyId = this.companyId();
    const userId = this.userId();
    const batchId = randomUUID();

    const updated = await this.prisma.tenant.$transaction(async (tx) => {
      // two bulk updates of the same company never overlap; the second one finds the first one's prices and goes stale
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId}::text || ':price-bulk'))`;
      if (await this.settings.get('sales.bulkPriceRequiresApproval', tx)) throw priceErrors.approvalRequired();

      const rows = await this.lockMatching(tx, companyId, input);
      if (rows.length > BULK_PRICE_MAX_PRODUCTS) throw priceErrors.tooManyProducts(rows.length, BULK_PRICE_MAX_PRODUCTS);
      const plan = this.plan(rows, adjustment);
      // a price edited or a product added since the preview changes the hash
      if (input.previewHash !== plan.hash) throw priceErrors.previewStale();
      if (plan.changes.length === 0) throw priceErrors.nothingToChange();

      await tx.$executeRaw`
        UPDATE products AS p
        SET sale_price = v.price, updated_by_id = ${userId}::uuid, updated_at = now()
        FROM unnest(${plan.changes.map((c) => c.productId)}::uuid[], ${plan.changes.map((c) => c.newPrice)}::numeric[]) AS v(id, price)
        WHERE p.id = v.id AND p.company_id = ${companyId}::uuid`;
      const written = await recordPriceChanges(
        tx,
        plan.changes.map((c) => ({ companyId, productId: c.productId, oldPrice: c.oldPrice, newPrice: c.newPrice, userId, source: 'BULK', reason, batchId })),
      );

      const counts = {
        matched: rows.length,
        changed: written,
        unchanged: plan.outcomes.filter((o) => o.status === 'UNCHANGED').length,
        invalid: plan.outcomes.filter((o) => o.status === 'INVALID').length,
      };
      const adjustmentSnapshot = { direction: adjustment.direction, percent: adjustment.percent.toString(), rounding: adjustment.rounding };
      await this.audit.log(
        {
          action: 'sales.price.bulk-update',
          entity: 'PriceBatch',
          entityId: batchId,
          after: { filter, adjustment: adjustmentSnapshot, counts, reason, previewHash: plan.hash },
        },
        tx as unknown as Prisma.TransactionClient,
      );
      await this.outbox.publish(
        'sales.prices.bulk-changed',
        { batchId, count: written, filter, ...adjustmentSnapshot, reason, userId },
        { tx, idempotencyKey: `price-batch:${batchId}` },
      );
      return written;
    }, APPLY_TRANSACTION_OPTIONS);

    return { batchId, updated };
  }

  /** The new price of every product, in the order given, with the hash of the rows that change (ordered by product id). */
  private plan(products: { id: string; price: string }[], adjustment: BulkAdjustment): Plan {
    const outcomes = products.map((product): Outcome => {
      const current = Decimal.of(product.price);
      const result = applyBulkAdjustment(current, adjustment);
      if ('newPrice' in result) return { productId: product.id, current, next: result.newPrice, status: 'CHANGE' };
      return { productId: product.id, current, next: null, status: result.skipped };
    });
    const changes = outcomes
      .filter((o): o is Outcome & { next: Decimal } => o.next !== null)
      .map((o) => ({ productId: o.productId, oldPrice: o.current.toString(), newPrice: o.next.toString() }))
      .sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));
    const hash = createHash('sha256')
      .update(changes.map((c) => `${c.productId}:${c.oldPrice}:${c.newPrice}`).join('\n'))
      .digest('hex');
    return { outcomes, changes, hash };
  }

  /** The matching products locked in id order. Raw SQL: Prisma has no `FOR UPDATE`. */
  private async lockMatching(tx: TenantTransaction, companyId: string, filter: Filter): Promise<{ id: string; price: string }[]> {
    const conditions: Prisma.Sql[] = [Prisma.sql`company_id = ${companyId}::uuid`, Prisma.sql`status <> 'DRAFT'`];
    if (filter.brandId) conditions.push(Prisma.sql`brand_id = ${filter.brandId}::uuid`);
    if (filter.categoryId) {
      conditions.push(
        Prisma.sql`(category_id = ${filter.categoryId}::uuid OR category_id IN (
          SELECT id FROM categories WHERE parent_id = ${filter.categoryId}::uuid AND company_id = ${companyId}::uuid))`,
      );
    }
    const rows = await tx.$queryRaw<{ id: string; sale_price: string }[]>(
      Prisma.sql`SELECT id::text AS id, sale_price::text AS sale_price FROM products WHERE ${Prisma.join(conditions, ' AND ')} ORDER BY id FOR UPDATE`,
    );
    return rows.map((row) => ({ id: row.id, price: row.sale_price }));
  }

  private adjustmentOf(input: BulkPriceInput): BulkAdjustment {
    const valid = validateBulkAdjustment(input);
    if (valid.ok) return valid.value;
    if (valid.error === 'INVALID_PERCENT') throw priceErrors.invalidPercent();
    throw priceErrors.invalidAdjustment(valid.error === 'INVALID_DIRECTION' ? 'direction' : 'rounding');
  }

  /** At least one filter, and the brand or category must be the company's own. Returns the filter with the names, for the audit. */
  private async checkFilter(filter: Filter): Promise<{ brandId?: string; brandName?: string; categoryId?: string; categoryName?: string }> {
    if (!filter.brandId && !filter.categoryId) throw priceErrors.filterRequired();
    const snapshot: { brandId?: string; brandName?: string; categoryId?: string; categoryName?: string } = {};
    if (filter.brandId) {
      const brand = await this.prisma.tenant.brand.findFirst({ where: { id: filter.brandId }, select: { id: true, name: true } });
      if (!brand) throw priceErrors.invalidFilter('brandId');
      snapshot.brandId = brand.id;
      snapshot.brandName = brand.name;
    }
    if (filter.categoryId) {
      const category = await this.prisma.tenant.category.findFirst({ where: { id: filter.categoryId }, select: { id: true, name: true } });
      if (!category) throw priceErrors.invalidFilter('categoryId');
      snapshot.categoryId = category.id;
      snapshot.categoryName = category.name;
    }
    return snapshot;
  }

  private companyId(): string {
    const companyId = this.cls.get('companyId');
    if (!companyId) throw new Error('Bulk prices outside a company context');
    return companyId;
  }

  private userId(): string {
    const userId = this.cls.get('userId');
    if (!userId) throw new Error('Bulk prices outside a user context');
    return userId;
  }
}
