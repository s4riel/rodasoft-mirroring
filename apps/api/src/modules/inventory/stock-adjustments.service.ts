import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ADJUSTMENT_LINES_MAX,
  ADJUSTMENT_PAGE_SIZE_DEFAULT,
  ADJUSTMENT_PAGE_SIZE_MAX,
  ADJUSTMENT_REASON_LABELS,
  ADJUSTMENT_REF_TYPE,
  adjustmentDelta,
  AdjustmentError,
  type AdjustmentDetail,
  type AdjustmentListItem,
  type AdjustmentLineGroup,
  type AdjustmentListResponse,
  type AdjustmentPasteError,
  type AdjustmentProductSearchResponse,
  type AdjustmentResolvedLine,
  type AdjustmentResolveResponse,
  type AdjustmentReason,
  adjustmentTotalValue,
  assertStockChanges,
  buildAdjustmentMovement,
  clampPage,
  type CreateAdjustmentResponse,
  parseAdjustmentPaste,
  validateAdjustmentDraft,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../common/audit/audit.service';
import type { AppClsStore } from '../../common/cls';
import { OutboxService } from '../../common/outbox/outbox.service';
import { PrismaService, type TenantTransaction } from '../../common/prisma/prisma.service';
import { MembershipService } from '../access/membership.service';
import { nextAdjustmentNumber } from './adjustment-number';
import { dayStart, nextDayStart } from './business-days';
import { type ListUploadFile, readListFile } from './list-file';
import type { AdjustmentProductSearchQueryDto, CreateAdjustmentDto, ListAdjustmentsQueryDto, ResolveAdjustmentLinesDto } from './stock-adjustments.dto';
import { StockMovementService } from './stock-movement.service';

const PRODUCT_SEARCH_LIMIT = 10;
/** A document of up to 200 lines locks and moves each one, and may wait behind another adjustment's numbering lock. */
const WRITE_TRANSACTION_OPTIONS = { timeout: 120_000, maxWait: 30_000 } as const;
const WAREHOUSE_SELECT = { id: true, name: true, branch: { select: { id: true, name: true } } } as const;

/**
 * Manual stock adjustments as documents (HU-INV-22): list, detail, product search and the multi-line form. A manual
 * adjustment has no approval step: it is created `APPROVED` (with nobody as approver, it applied itself) and writes its
 * movements in the same transaction, always through `StockMovementService`. Only the adjustments a transfer receipt leaves
 * (HU-INV-21) wait for approval, and they show in the same list.
 */
@Injectable()
export class StockAdjustmentsService {
  private readonly logger = new Logger(StockAdjustmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly stock: StockMovementService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly membership: MembershipService,
  ) {}

  // ── Reads ──────────────────────────────────────────────────────────────────

  async list(query: ListAdjustmentsQueryDto): Promise<AdjustmentListResponse> {
    const granted = await this.assertCanRead();
    const allowed = await this.operableBranches();
    const page = clampPage(query.page);
    const pageSize = Math.min(query.pageSize ?? ADJUSTMENT_PAGE_SIZE_DEFAULT, ADJUSTMENT_PAGE_SIZE_MAX);

    const and: Prisma.StockAdjustmentWhereInput[] = [];
    if (allowed) and.push({ warehouse: { branchId: { in: allowed } } });
    if (query.status) and.push({ status: query.status });
    if (query.warehouseId) and.push({ warehouseId: query.warehouseId });
    if (query.reason) and.push({ reason: query.reason });
    if (query.q) {
      and.push({
        OR: [
          { number: { contains: query.q, mode: 'insensitive' } },
          { items: { some: { product: { OR: [{ manufacturerCode: { contains: query.q, mode: 'insensitive' } }, { sku: { contains: query.q, mode: 'insensitive' } }] } } } },
        ],
      });
    }
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) createdAt.gte = dayStart(query.from);
    if (query.to) createdAt.lt = nextDayStart(query.to);
    if (createdAt.gte && createdAt.lt && createdAt.gte >= createdAt.lt) {
      throw new BadRequestException({ code: 'INVALID_FILTER', message: 'The date range is empty' });
    }
    if (createdAt.gte || createdAt.lt) and.push({ createdAt });
    const where: Prisma.StockAdjustmentWhereInput = { AND: and };

    const canViewCosts = granted.has('inventory.costs.view');
    const [total, rows] = await Promise.all([
      this.prisma.tenant.stockAdjustment.count({ where }),
      this.prisma.tenant.stockAdjustment.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { ...HEADER_SELECT, _count: { select: { items: true } } },
      }),
    ]);
    return { items: rows.map((r) => toListItem(r, r._count.items, canViewCosts)), total, page, pageSize };
  }

  async get(id: string): Promise<AdjustmentDetail> {
    const granted = await this.assertCanRead();
    const allowed = await this.operableBranches();
    const canViewCosts = granted.has('inventory.costs.view');
    const row = await this.prisma.tenant.stockAdjustment.findFirst({
      where: { id, ...(allowed ? { warehouse: { branchId: { in: allowed } } } : {}) },
      select: {
        ...HEADER_SELECT,
        note: true,
        approvedAt: true,
        approvedBy: { select: { name: true } },
        items: {
          orderBy: [{ product: { manufacturerCode: 'asc' } }, { id: 'asc' }],
          select: {
            productId: true,
            kind: true,
            quantity: true,
            enteredQuantity: true,
            unitCost: true,
            product: { select: { sku: true, manufacturerCode: true, name: true, brand: { select: { name: true } } } },
          },
        },
      },
    });
    if (!row) throw new NotFoundException({ code: 'ADJUSTMENT_NOT_FOUND', message: 'Adjustment not found' });
    return {
      ...toListItem(row, row.items.length, canViewCosts),
      note: row.note,
      approvedBy: row.approvedBy?.name ?? null,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      items: row.items.map((i) => {
        const unitCost = i.unitCost?.toFixed(4) ?? null;
        return {
          productId: i.productId,
          sku: i.product.sku,
          manufacturerCode: i.product.manufacturerCode,
          name: i.product.name,
          brand: i.product.brand.name,
          kind: i.kind,
          enteredQuantity: i.enteredQuantity,
          delta: i.quantity,
          unitCost: canViewCosts ? unitCost : null,
          value: canViewCosts && unitCost !== null ? adjustmentTotalValue([{ delta: i.quantity, unitCost }]) : null,
        };
      }),
    };
  }

  /** Active products matching the text, with the stock they have in the warehouse being adjusted. */
  async productSearch(query: AdjustmentProductSearchQueryDto): Promise<AdjustmentProductSearchResponse> {
    const granted = await this.assertCanCreate();
    const allowed = await this.operableBranches();
    await this.assertWarehouseVisible(this.prisma.tenant, query.warehouseId, allowed);
    const search = query.q.trim();
    if (!search) return { items: [] };

    const canViewCosts = granted.has('inventory.costs.view');
    const select = {
      id: true,
      sku: true,
      manufacturerCode: true,
      name: true,
      cost: true,
      brand: { select: { name: true } },
      stockLevels: { where: { warehouseId: query.warehouseId }, select: { quantity: true } },
    } satisfies Prisma.ProductSelect;
    // the exact code is its own query: with a broad text many products match by name or brand, and the one typed in full
    // must not be cut before it is ranked (Enter adds the first result)
    const [exact, matching] = await Promise.all([
      this.prisma.tenant.product.findMany({
        where: {
          status: 'ACTIVE',
          OR: [{ manufacturerCode: { equals: search, mode: 'insensitive' } }, { sku: { equals: search, mode: 'insensitive' } }],
        },
        orderBy: [{ manufacturerCode: 'asc' }, { id: 'asc' }],
        take: PRODUCT_SEARCH_LIMIT,
        select,
      }),
      this.prisma.tenant.product.findMany({
        where: {
          status: 'ACTIVE',
          OR: [
            { manufacturerCode: { contains: search, mode: 'insensitive' } },
            { sku: { contains: search, mode: 'insensitive' } },
            { name: { contains: search, mode: 'insensitive' } },
            { brand: { name: { contains: search, mode: 'insensitive' } } },
          ],
        },
        orderBy: [{ manufacturerCode: 'asc' }, { id: 'asc' }],
        take: PRODUCT_SEARCH_LIMIT * 3,
        select,
      }),
    ]);
    const seen = new Set<string>();
    const products = [...exact, ...matching].filter((p) => !seen.has(p.id) && !!seen.add(p.id));
    // the code typed in full first, then codes that start with it, so Enter adds the product the user means
    const lower = search.toLowerCase();
    const rank = (code: string) => (code.toLowerCase() === lower ? 0 : code.toLowerCase().startsWith(lower) ? 1 : 2);
    const items = products
      .map((p) => ({
        id: p.id,
        sku: p.sku,
        manufacturerCode: p.manufacturerCode,
        name: p.name,
        brand: p.brand.name,
        available: p.stockLevels[0]?.quantity ?? 0,
        unitCost: canViewCosts && p.cost ? p.cost.toFixed(4) : null,
      }))
      .sort((a, b) => rank(a.manufacturerCode) - rank(b.manufacturerCode))
      .slice(0, PRODUCT_SEARCH_LIMIT);
    return { items };
  }

  /**
   * Reads a pasted list or an uploaded .xlsx/.csv (`code`, `quantity`, optional `kind`) and says what each line is, before
   * anything is added to an adjustment: recognized, not found, inactive, or an outward line without enough stock. Writes nothing.
   */
  async resolveLines(dto: ResolveAdjustmentLinesDto, file: ListUploadFile | undefined): Promise<AdjustmentResolveResponse> {
    const granted = await this.assertCanCreate();
    await this.assertWarehouseVisible(this.prisma.tenant, dto.warehouseId, await this.operableBranches());
    if (!file && dto.text === undefined) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid request', details: [{ field: 'text', code: 'TEXT_OR_FILE_REQUIRED' }] });
    }

    const text = file ? await readListFile(file, 3) : (dto.text ?? '');
    const { rows, errors } = parseAdjustmentPaste(text);
    if (rows.length > ADJUSTMENT_LINES_MAX) {
      throw new UnprocessableEntityException({ code: 'TOO_MANY_LINES', message: `An adjustment carries at most ${ADJUSTMENT_LINES_MAX} products` });
    }

    const wanted = [...new Set(rows.map((r) => r.code.toLowerCase()))];
    const products = wanted.length
      ? await this.prisma.tenant.product.findMany({
          where: {
            status: { not: 'DRAFT' },
            OR: wanted.flatMap((code) => [
              { manufacturerCode: { equals: code, mode: 'insensitive' as const } },
              { sku: { equals: code, mode: 'insensitive' as const } },
            ]),
          },
          orderBy: [{ status: 'asc' }, { brand: { name: 'asc' } }, { id: 'asc' }],
          select: {
            id: true,
            sku: true,
            manufacturerCode: true,
            name: true,
            status: true,
            cost: true,
            brand: { select: { name: true } },
            stockLevels: { where: { warehouseId: dto.warehouseId }, select: { quantity: true } },
          },
        })
      : [];
    // the same code can exist under several brands: the active one that sorts first is offered, and the preview shows its brand
    const byCode = new Map<string, (typeof products)[number]>();
    for (const p of products) {
      for (const key of [p.manufacturerCode.toLowerCase(), p.sku.toLowerCase()]) {
        const current = byCode.get(key);
        if (!current || (current.status !== 'ACTIVE' && p.status === 'ACTIVE')) byCode.set(key, p);
      }
    }

    const counts: Record<AdjustmentLineGroup, number> = { RECOGNIZED: 0, NOT_FOUND: 0, INSUFFICIENT_STOCK: 0, INACTIVE: 0 };
    const taken = new Set<string>();
    const duplicates: AdjustmentPasteError[] = [];
    const lines: AdjustmentResolvedLine[] = [];
    for (const row of rows) {
      const product = byCode.get(row.code.toLowerCase());
      // two codes can name one product (its manufacturer code and its SKU), and a product appears once in an adjustment
      if (product && taken.has(product.id)) {
        duplicates.push({ line: row.line, reason: 'DUPLICATE_CODE', text: `${row.code}, ${row.quantity}` });
        continue;
      }
      if (product) taken.add(product.id);
      if (!product) {
        counts.NOT_FOUND += 1;
        lines.push({ ...row, group: 'NOT_FOUND', product: null, available: null, unitCost: null });
        continue;
      }
      const available = product.stockLevels[0]?.quantity ?? 0;
      const group: AdjustmentLineGroup =
        product.status !== 'ACTIVE' ? 'INACTIVE' : row.kind === 'OUT' && row.quantity > available ? 'INSUFFICIENT_STOCK' : 'RECOGNIZED';
      counts[group] += 1;
      lines.push({
        ...row,
        group,
        product: { id: product.id, sku: product.sku, manufacturerCode: product.manufacturerCode, name: product.name, brand: product.brand.name },
        available,
        unitCost: granted.has('inventory.costs.view') && product.cost ? product.cost.toFixed(4) : null,
      });
    }
    return { lines, errors: [...errors, ...duplicates].sort((a, b) => a.line - b.line), counts };
  }

  // ── Create ─────────────────────────────────────────────────────────────────

  async create(dto: CreateAdjustmentDto): Promise<CreateAdjustmentResponse> {
    const granted = await this.assertCanCreate();
    const companyId = this.cls.get('companyId');
    if (!companyId) throw new Error('Stock adjustment outside a company context');
    const userId = this.cls.get('userId') ?? null;
    const allowed = await this.operableBranches();

    const { reason, note } = this.rule(() => validateAdjustmentDraft({ reason: dto.reason, note: dto.note, lines: dto.lines }));
    // lines go in product-id order, the order the locks are taken in, so two adjustments cannot deadlock on each other
    const lines = [...dto.lines].sort((a, b) => a.productId.localeCompare(b.productId));

    return this.prisma.tenant.$transaction(async (tx) => {
      await this.assertWarehouseVisible(tx, dto.warehouseId, allowed);
      const products = await tx.product.findMany({ where: { id: { in: lines.map((l) => l.productId) }, companyId }, select: { id: true, sku: true } });
      const skuById = new Map(products.map((p) => [p.id, p.sku]));
      if (skuById.size !== lines.length) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });

      // numbering lock first, then the product and level locks (the order the quick adjustment uses)
      const number = await nextAdjustmentNumber(tx, companyId);

      const planned: { productId: string; kind: (typeof lines)[number]['kind']; entered: number; delta: number; unitCost: string | null }[] = [];
      for (const line of lines) {
        const { quantity: balance } = await this.stock.lockedQuantity(tx, line.productId, dto.warehouseId);
        if (line.expectedBalance !== undefined && line.expectedBalance !== balance) {
          throw new ConflictException({
            code: 'STOCK_CHANGED',
            message: 'The stock changed since it was read',
            details: { productId: line.productId, currentBalance: balance },
          });
        }
        const delta = this.rule(() => adjustmentDelta({ kind: line.kind, quantity: line.quantity, balance }));
        // the cost is read under the product lock, so the value stored is the value of the movement
        const { cost } = await tx.product.findFirstOrThrow({ where: { id: line.productId, companyId }, select: { cost: true } });
        if (delta !== 0 && !cost) this.logger.warn(`Adjustment ${number}: ${skuById.get(line.productId)} has no cost, its value counts as 0`);
        planned.push({ productId: line.productId, kind: line.kind, entered: line.quantity, delta, unitCost: cost ? cost.toFixed(4) : null });
      }
      this.rule(() => assertStockChanges(planned.map((p) => p.delta)));

      const totalValue = adjustmentTotalValue(planned);
      const adjustment = await tx.stockAdjustment.create({
        select: { id: true },
        data: {
          companyId,
          number,
          status: 'APPROVED',
          source: 'MANUAL',
          warehouseId: dto.warehouseId,
          reason,
          note,
          totalValue,
          createdById: userId,
          approvedAt: new Date(),
        },
      });
      await tx.stockAdjustmentItem.createMany({
        data: planned.map((p) => ({
          companyId,
          adjustmentId: adjustment.id,
          productId: p.productId,
          kind: p.kind,
          quantity: p.delta,
          enteredQuantity: p.entered,
          unitCost: p.unitCost,
        })),
      });

      let movements = 0;
      for (const p of planned) {
        if (p.delta === 0) continue;
        const movement = this.rule(() =>
          buildAdjustmentMovement({ direction: p.delta > 0 ? 'IN' : 'OUT', quantity: Math.abs(p.delta), reason, note }),
        );
        const { movementId, balanceAfter } = await this.stock.apply(tx, {
          productId: p.productId,
          warehouseId: dto.warehouseId,
          type: movement.type,
          quantity: movement.signedQuantity,
          reason: movement.reasonText,
          refType: ADJUSTMENT_REF_TYPE,
          refId: adjustment.id,
          refNumber: number,
          unitCost: p.unitCost,
        });
        movements += 1;
        await this.outbox.publish(
          'inventory.stock.changed',
          { productId: p.productId, warehouseId: dto.warehouseId, movementId, type: movement.type, quantity: movement.signedQuantity, balanceAfter, userId },
          { tx, companyId, idempotencyKey: `inventory.stock.changed:${movementId}` },
        );
      }

      // created already APPROVED (an initial state, not a transition of stockAdjustmentMachine): audited as the apply
      await this.audit.log(
        {
          action: 'inventory.adjustment.create',
          entity: 'StockAdjustment',
          entityId: adjustment.id,
          after: {
            number,
            status: 'APPROVED',
            warehouseId: dto.warehouseId,
            reason,
            note,
            totalValue,
            lines: planned.map((p) => ({ productId: p.productId, kind: p.kind, entered: p.entered, delta: p.delta })),
          },
        },
        tx as unknown as Prisma.TransactionClient,
      );

      return {
        id: adjustment.id,
        number,
        status: 'APPROVED' as const,
        totalValue: granted.has('inventory.costs.view') ? totalValue : null,
        movements,
      };
    }, WRITE_TRANSACTION_OPTIONS);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Runs a domain rule and turns the `AdjustmentError` it throws into the HTTP answer with the same code. */
  private rule<T>(run: () => T): T {
    try {
      return run();
    } catch (err) {
      if (err instanceof AdjustmentError) {
        const body = { code: err.code, message: err.message };
        throw err.code === 'NO_STOCK_CHANGE' ? new UnprocessableEntityException(body) : new BadRequestException(body);
      }
      if (err instanceof RangeError) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: err.message });
      throw err;
    }
  }

  private async granted(): Promise<ReadonlySet<string>> {
    const membershipId = this.cls.get('membershipId');
    return membershipId ? this.membership.permissions(membershipId) : new Set<string>();
  }

  /** Listing and opening an adjustment is for those who create or approve them. */
  private async assertCanRead(): Promise<ReadonlySet<string>> {
    const granted = await this.granted();
    if (!granted.has('inventory.adjustments.create') && !granted.has('inventory.adjustments.approve')) {
      throw new ForbiddenException({ code: 'NO_PERMISSION', message: 'You do not have permission for this action' });
    }
    return granted;
  }

  private async assertCanCreate(): Promise<ReadonlySet<string>> {
    const granted = await this.granted();
    if (!granted.has('inventory.adjustments.create')) {
      throw new ForbiddenException({ code: 'NO_PERMISSION', message: 'You do not have permission for this action', details: { missing: ['inventory.adjustments.create'] } });
    }
    return granted;
  }

  /** Branches the member may operate; `null` means every branch. */
  private async operableBranches(): Promise<string[] | null> {
    const membershipId = this.cls.get('membershipId');
    return membershipId ? this.membership.operableBranchIds(membershipId) : [];
  }

  /** The warehouse must belong to a branch the member may operate; otherwise it does not exist for them. */
  private async assertWarehouseVisible(tx: Pick<TenantTransaction, 'warehouse'>, warehouseId: string, allowed: string[] | null): Promise<void> {
    const warehouse = await tx.warehouse.findFirst({ where: { id: warehouseId }, select: { branchId: true } });
    if (!warehouse || (allowed && !allowed.includes(warehouse.branchId))) {
      throw new NotFoundException({ code: 'WAREHOUSE_NOT_FOUND', message: 'Warehouse not found' });
    }
  }
}

const HEADER_SELECT = {
  id: true,
  number: true,
  status: true,
  source: true,
  reason: true,
  totalValue: true,
  createdAt: true,
  warehouse: { select: WAREHOUSE_SELECT },
  createdBy: { select: { name: true } },
} satisfies Prisma.StockAdjustmentSelect;

function toListItem(
  row: Prisma.StockAdjustmentGetPayload<{ select: typeof HEADER_SELECT }>,
  lines: number,
  canViewCosts: boolean,
): AdjustmentListItem {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    source: row.source,
    warehouse: row.warehouse,
    reason: ADJUSTMENT_REASON_LABELS[row.reason as AdjustmentReason] ?? row.reason,
    lines,
    value: canViewCosts ? row.totalValue.toFixed(2) : null,
    createdBy: row.createdBy?.name ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
