import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  assertTransferLineCount,
  assertTransferWarehouses,
  clampPage,
  formatTransferNumber,
  InvalidTransitionError,
  parseMeasurement,
  parseTransferNumber,
  parseTransferPaste,
  TRANSFER_FILE_MAX_BYTES,
  TRANSFER_LINE_QUANTITY_MAX,
  TRANSFER_OPEN_STATUSES,
  TRANSFER_PAGE_SIZE_DEFAULT,
  TRANSFER_PAGE_SIZE_MAX,
  TRANSFER_REF_TYPE,
  TransferError,
  type TransferDetail,
  type TransferLineGroup,
  type TransferListResponse,
  type TransferOpenCountResponse,
  type TransferProductSearchResponse,
  type TransferResolveResponse,
  type TransferResolvedLine,
  type TransferStatus,
  type TransferValidation,
  type TransferWarehousesResponse,
  transferMachine,
  validateTransferLines,
} from '@rodasoft/domain';
import ExcelJS from 'exceljs';
import { ClsService } from 'nestjs-cls';
import { type AuditEntry, AuditService } from '../../common/audit/audit.service';
import type { AppClsStore } from '../../common/cls';
import { OutboxService } from '../../common/outbox/outbox.service';
import { PrismaService, type TenantTransaction } from '../../common/prisma/prisma.service';
import { SettingsService } from '../../common/settings/settings.service';
import { MembershipService } from '../access/membership.service';
import { StockMovementService } from './stock-movement.service';
import type { ListTransfersQueryDto, ProductSearchQueryDto, ResolveLinesDto, SaveTransferDto, SendTransferDto } from './transfers.dto';

export interface TransferUploadFile {
  buffer: Buffer;
  size: number;
  originalname: string;
}

interface ProductInfo {
  id: string;
  sku: string;
  manufacturerCode: string;
  name: string;
  brand: string;
  active: boolean;
  cost: string | null;
}

/** What a send needs of the transfer, read after its row is locked. */
interface TransferToSend {
  number: string;
  originWarehouseId: string;
  destinationWarehouseId: string;
  items: { id: string; productId: string; quantity: number }[];
}

interface TransferTotals {
  pieces: number;
  value: string;
}

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
/** A sheet with more rows than this is not a product list; it also keeps a far-away cell from making the reader walk empty rows. */
const SHEET_ROW_CEILING = 20_000;
const PRODUCT_SEARCH_LIMIT = 10;
const WAREHOUSE_SELECT = { id: true, name: true, branch: { select: { id: true, name: true } } } as const;

/**
 * Transfers between warehouses (HU-INV-18): list, draft editor, resolution of pasted or uploaded lists, and sending.
 * Sending is the only step that moves stock, and it does so through `StockMovementService` in the transaction that also
 * changes the status, so a failed line leaves no partial movement. In transit is not stored; it is derived from the
 * items of the sent transfers (see `StockQueriesService`).
 */
@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly stock: StockMovementService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly membership: MembershipService,
  ) {}

  // ── Reads ──────────────────────────────────────────────────────────────────

  async list(query: ListTransfersQueryDto): Promise<TransferListResponse> {
    const granted = await this.assertCanRead();
    const allowed = await this.operableBranches();
    const page = clampPage(query.page);
    const pageSize = Math.min(query.pageSize ?? TRANSFER_PAGE_SIZE_DEFAULT, TRANSFER_PAGE_SIZE_MAX);

    const and: Prisma.TransferWhereInput[] = [visibleTo(allowed)];
    if (query.status) and.push({ status: query.status });
    if (query.originWarehouseId) and.push({ originWarehouseId: query.originWarehouseId });
    if (query.destinationWarehouseId) and.push({ destinationWarehouseId: query.destinationWarehouseId });
    if (query.q) {
      // the list searches by number or by the branch on either side (IN-05: "Buscar por N.º o sucursal")
      and.push({
        OR: [
          { number: { contains: query.q, mode: 'insensitive' } },
          { originWarehouse: { branch: { name: { contains: query.q, mode: 'insensitive' } } } },
          { destinationWarehouse: { branch: { name: { contains: query.q, mode: 'insensitive' } } } },
        ],
      });
    }
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) createdAt.gte = dayStart(query.from);
    if (query.to) createdAt.lt = nextDayStart(query.to);
    if (createdAt.gte || createdAt.lt) and.push({ createdAt });
    if (createdAt.gte && createdAt.lt && createdAt.gte >= createdAt.lt) {
      throw new BadRequestException({ code: 'INVALID_FILTER', message: 'The date range is empty' });
    }
    const where: Prisma.TransferWhereInput = { AND: and };

    const [total, rows] = await Promise.all([
      this.prisma.tenant.transfer.count({ where }),
      this.prisma.tenant.transfer.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          number: true,
          status: true,
          totalPieces: true,
          totalValue: true,
          createdAt: true,
          sentAt: true,
          _count: { select: { items: true } },
          originWarehouse: { select: WAREHOUSE_SELECT },
          destinationWarehouse: { select: WAREHOUSE_SELECT },
          createdBy: { select: { name: true } },
          sentBy: { select: { name: true } },
        },
      }),
    ]);

    const canViewCosts = granted.has('inventory.costs.view');
    return {
      items: rows.map((r) => ({
        id: r.id,
        number: r.number,
        status: r.status,
        origin: r.originWarehouse,
        destination: r.destinationWarehouse,
        products: r._count.items,
        pieces: r.totalPieces,
        value: canViewCosts ? r.totalValue.toFixed(2) : null,
        createdBy: r.createdBy?.name ?? null,
        sentBy: r.sentBy?.name ?? null,
        createdAt: r.createdAt.toISOString(),
        sentAt: r.sentAt?.toISOString() ?? null,
      })),
      total,
      page,
      pageSize,
    };
  }

  /** How many transfers visible to the member are still open: the count on the Transferencias tab of the sub-nav. */
  async openCount(): Promise<TransferOpenCountResponse> {
    await this.assertCanRead();
    const allowed = await this.operableBranches();
    const count = await this.prisma.tenant.transfer.count({
      where: { AND: [visibleTo(allowed), { status: { in: [...TRANSFER_OPEN_STATUSES] } }] },
    });
    return { count };
  }

  async get(id: string): Promise<TransferDetail> {
    const granted = await this.assertCanRead();
    const allowed = await this.operableBranches();
    return this.prisma.tenant.$transaction(async (tx) => {
      await this.findVisible(tx, id, allowed);
      return this.detail(tx, id, granted);
    });
  }

  /** Every active warehouse of the company, flagged with whether the member may send from it. */
  async warehouses(): Promise<TransferWarehousesResponse> {
    await this.assertCanWrite();
    const allowed = await this.operableBranches();
    const rows = await this.prisma.tenant.warehouse.findMany({
      where: { status: 'ACTIVE', branch: { status: 'ACTIVE' } },
      orderBy: [{ branch: { code: 'asc' } }, { code: 'asc' }],
      select: { id: true, code: true, name: true, branchId: true, branch: { select: { id: true, name: true } } },
    });
    return {
      items: rows.map((w) => ({ id: w.id, code: w.code, name: w.name, branch: w.branch, canSendFrom: !allowed || allowed.includes(w.branchId) })),
    };
  }

  /** Active products matching the text, with the stock they have at the origin warehouse. */
  async productSearch(query: ProductSearchQueryDto): Promise<TransferProductSearchResponse> {
    const canViewCosts = (await this.assertCanWrite()).has('inventory.costs.view');
    await this.assertOriginReadable(query.warehouseId);
    const search = query.q.trim();
    if (!search) return { items: [] };

    const measurement = parseMeasurement(search);
    const select = {
      id: true,
      sku: true,
      manufacturerCode: true,
      name: true,
      cost: true,
      brand: { select: { name: true } },
      stockLevels: { where: { warehouseId: query.warehouseId }, select: { quantity: true } },
    } satisfies Prisma.ProductSelect;
    // the exact code is its own query: with a short text, many products match by name or brand, and the one typed in full
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
            ...(measurement ? [{ dimensions: { is: measurement } }] : []),
          ],
        },
        orderBy: [{ manufacturerCode: 'asc' }, { id: 'asc' }],
        take: PRODUCT_SEARCH_LIMIT * 3,
        select,
      }),
    ]);
    const seen = new Set<string>();
    const products = [...exact, ...matching].filter((p) => !seen.has(p.id) && !!seen.add(p.id));
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
   * Reads a pasted list or an uploaded .xlsx/.csv (`code`, `quantity`) and says what each line is, before anything is
   * added to a transfer: recognized, not found, inactive, or without enough stock at the origin. Writes nothing.
   */
  async resolveLines(dto: ResolveLinesDto, file: TransferUploadFile | undefined): Promise<TransferResolveResponse> {
    const canViewCosts = (await this.assertCanWrite()).has('inventory.costs.view');
    await this.assertOriginReadable(dto.warehouseId);
    if (!file && dto.text === undefined) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid request', details: [{ field: 'text', code: 'TEXT_OR_FILE_REQUIRED' }] });
    }

    const text = file ? await readListFile(file) : (dto.text ?? '');
    const { rows, errors } = parseTransferPaste(text);
    const maxLines = await this.settings.get('transfers.maxLines');
    if (rows.length > maxLines) {
      throw new UnprocessableEntityException({ code: 'TOO_MANY_LINES', message: `A transfer carries at most ${maxLines} products` });
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

    // two codes can name one product (its manufacturer code and its SKU): they are one line, checked against the stock together
    const merged: { row: (typeof rows)[number]; product: (typeof products)[number] | undefined }[] = [];
    const indexOfProduct = new Map<string, number>();
    for (const row of rows) {
      const product = byCode.get(row.code.toLowerCase());
      const at = product ? indexOfProduct.get(product.id) : undefined;
      if (at !== undefined) {
        const first = merged[at].row;
        merged[at].row = { ...first, quantity: Math.min(first.quantity + row.quantity, TRANSFER_LINE_QUANTITY_MAX) };
        continue;
      }
      if (product) indexOfProduct.set(product.id, merged.length);
      merged.push({ row, product });
    }

    const counts: Record<TransferLineGroup, number> = { RECOGNIZED: 0, NOT_FOUND: 0, INSUFFICIENT_STOCK: 0, INACTIVE: 0 };
    const lines = merged.map(({ row, product }): TransferResolvedLine => {
      if (!product) {
        counts.NOT_FOUND += 1;
        return { line: row.line, code: row.code, quantity: row.quantity, group: 'NOT_FOUND', product: null, available: null, unitCost: null };
      }
      const available = product.stockLevels[0]?.quantity ?? 0;
      const group: TransferLineGroup =
        product.status !== 'ACTIVE' ? 'INACTIVE' : row.quantity > available ? 'INSUFFICIENT_STOCK' : 'RECOGNIZED';
      counts[group] += 1;
      return {
        line: row.line,
        code: row.code,
        quantity: row.quantity,
        group,
        product: { id: product.id, sku: product.sku, manufacturerCode: product.manufacturerCode, name: product.name, brand: product.brand.name },
        available,
        unitCost: canViewCosts && product.cost ? product.cost.toFixed(4) : null,
      };
    });
    return { lines, errors, counts };
  }

  // ── Writes ─────────────────────────────────────────────────────────────────

  async create(dto: SaveTransferDto): Promise<TransferDetail> {
    const granted = await this.assertCanWrite();
    const companyId = this.companyId();
    const userId = this.cls.get('userId') ?? null;
    const allowed = await this.operableBranches();

    return this.writeTransaction(async (tx) => {
      const { origin } = await this.checkDraft(tx, dto, allowed);
      const number = await this.nextNumber(tx, companyId);
      const { validation } = await this.validate(tx, dto.originWarehouseId, dto.lines);
      const transfer = await tx.transfer.create({
        select: { id: true },
        data: {
          companyId,
          number,
          originWarehouseId: origin.id,
          destinationWarehouseId: dto.destinationWarehouseId,
          note: dto.note ?? null,
          totalPieces: validation.summary.pieces,
          totalValue: validation.summary.value,
          createdById: userId,
        },
      });
      await tx.transferItem.createMany({
        data: dto.lines.map((l) => ({ companyId, transferId: transfer.id, productId: l.productId, quantity: l.quantity })),
      });
      await this.recordAudit(tx, {
        action: 'inventory.transfer.create',
        entity: 'Transfer',
        entityId: transfer.id,
        after: { number, origin: origin.id, destination: dto.destinationWarehouseId, lines: dto.lines.length },
      });
      return this.detail(tx, transfer.id, granted);
    });
  }

  /** Replaces the header and the lines of a draft. The client sends the `updatedAt` it read, so a stale editor cannot overwrite. */
  async update(id: string, dto: SaveTransferDto): Promise<TransferDetail> {
    const granted = await this.assertCanWrite();
    const companyId = this.companyId();
    const allowed = await this.operableBranches();
    const expectedUpdatedAt = dto.expectedUpdatedAt;
    if (!expectedUpdatedAt) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid request', details: [{ field: 'expectedUpdatedAt', code: 'REQUIRED' }] });
    }

    return this.writeTransaction(async (tx) => {
      const current = await this.findVisible(tx, id, allowed);
      this.assertOperable(allowed, current.originWarehouse.branchId);
      const locked = await this.lock(tx, id, companyId);
      this.assertFresh(locked.updatedAt, expectedUpdatedAt);
      if (locked.status !== 'DRAFT') {
        throw new UnprocessableEntityException({ code: 'TRANSFER_NOT_EDITABLE', message: 'Only a draft can be edited' });
      }

      const { origin } = await this.checkDraft(tx, dto, allowed);
      const { validation } = await this.validate(tx, dto.originWarehouseId, dto.lines);
      await tx.transferItem.deleteMany({ where: { transferId: id } });
      await tx.transferItem.createMany({
        data: dto.lines.map((l) => ({ companyId, transferId: id, productId: l.productId, quantity: l.quantity })),
      });
      await tx.transfer.update({
        where: { id },
        data: {
          originWarehouseId: origin.id,
          destinationWarehouseId: dto.destinationWarehouseId,
          note: dto.note ?? null,
          totalPieces: validation.summary.pieces,
          totalValue: validation.summary.value,
        },
      });
      await this.recordAudit(tx, {
        action: 'inventory.transfer.update',
        entity: 'Transfer',
        entityId: id,
        before: { lines: current.items.length },
        after: { origin: origin.id, destination: dto.destinationWarehouseId, lines: dto.lines.length },
      });
      return this.detail(tx, id, granted);
    });
  }

  /**
   * Sends a draft. There is no approval step (client feedback): every line leaves the origin as a `TRANSFER_OUT` movement and
   * the transfer becomes IN_TRANSIT at once, all in one transaction: a line that cannot be taken (stock changed
   * meanwhile) rolls back the whole send.
   */
  async send(id: string, dto: SendTransferDto): Promise<TransferDetail> {
    const granted = await this.assertCanWrite();
    const companyId = this.companyId();
    const userId = this.cls.get('userId') ?? null;
    const allowed = await this.operableBranches();

    return this.writeTransaction(async (tx) => {
      const current = await this.findVisible(tx, id, allowed);
      this.assertOperable(allowed, current.originWarehouse.branchId);
      const locked = await this.lock(tx, id, companyId);
      if (dto.expectedUpdatedAt) this.assertFresh(locked.updatedAt, dto.expectedUpdatedAt);
      if (!transferMachine.can(locked.status, 'send')) throw invalidTransition(locked.status, 'send');

      const transfer = await this.loadForSend(tx, id, companyId);
      const { validation, products } = await this.validate(tx, transfer.originWarehouseId, transfer.items);
      if (validation.summary.errors > 0) {
        // decision #35: no partial send; the flagged lines are returned so the editor can mark them
        throw new UnprocessableEntityException({
          code: 'TRANSFER_HAS_ERRORS',
          message: 'The transfer has lines with errors',
          details: { lines: validation.lines.filter((l) => l.status !== 'OK') },
        });
      }

      const totals = { pieces: validation.summary.pieces, value: validation.summary.value };
      await this.takeStockOut(tx, id, transfer, products);
      await this.freezeItemCosts(tx, transfer.items, products);
      await this.markSent(tx, { id, transfer, from: locked.status, totals, userId, companyId });
      return this.detail(tx, id, granted);
    });
  }

  async cancel(id: string): Promise<TransferDetail> {
    const granted = await this.assertCanWrite();
    const companyId = this.companyId();
    const allowed = await this.operableBranches();

    return this.writeTransaction(async (tx) => {
      const current = await this.findVisible(tx, id, allowed);
      this.assertOperable(allowed, current.originWarehouse.branchId);
      const locked = await this.lock(tx, id, companyId);
      if (!transferMachine.can(locked.status, 'cancel')) throw invalidTransition(locked.status, 'cancel');
      const to = transferMachine.next(locked.status, 'cancel');
      await tx.transfer.update({ where: { id }, data: { status: to } });
      await this.recordAudit(tx, {
        action: 'inventory.transfer.cancel',
        entity: 'Transfer',
        entityId: id,
        before: { status: locked.status },
        after: { status: to },
      });
      return this.detail(tx, id, granted);
    });
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /**
   * A write that touches every line of a transfer: Prisma's default 5 s would expire on a few hundred lines, each of which
   * locks and moves stock, and a send that expires is a 500 with nothing sent. Same window the product import uses.
   */
  private writeTransaction<T>(fn: (tx: TenantTransaction) => Promise<T>): Promise<T> {
    return this.prisma.tenant.$transaction(fn, { timeout: 120_000, maxWait: 30_000 });
  }

  /**
   * The transfer as it stands after the lock (an edit that committed first is what gets sent), checked to have lines and two
   * active warehouses.
   */
  private async loadForSend(tx: TenantTransaction, id: string, companyId: string): Promise<TransferToSend> {
    const transfer = await tx.transfer.findFirstOrThrow({
      where: { id },
      select: {
        number: true,
        originWarehouseId: true,
        destinationWarehouseId: true,
        items: { select: { id: true, productId: true, quantity: true }, orderBy: { productId: 'asc' } },
        originWarehouse: { select: { status: true } },
      },
    });
    if (!transfer.items.length) {
      throw new UnprocessableEntityException({ code: 'TRANSFER_EMPTY', message: 'The transfer has no products' });
    }
    // FOR SHARE on the destination, as `apply` does on the origin: deactivating a warehouse takes FOR UPDATE on its row, so
    // the check below stays true until this send commits and pieces never leave for a warehouse that was just closed
    const [destination] = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM warehouses
      WHERE id = ${transfer.destinationWarehouseId}::uuid AND company_id = ${companyId}::uuid FOR SHARE`;
    asHttpRule(() =>
      assertTransferWarehouses(
        { id: transfer.originWarehouseId, active: transfer.originWarehouse.status === 'ACTIVE' },
        { id: transfer.destinationWarehouseId, active: destination?.status === 'ACTIVE' },
      ),
    );
    return transfer;
  }

  /** Every line leaves the origin as a `TRANSFER_OUT` movement. */
  private async takeStockOut(tx: TenantTransaction, id: string, transfer: TransferToSend, products: ReadonlyMap<string, ProductInfo>): Promise<void> {
    // products in id order, the order every other movement locks them in, so two sends cannot deadlock
    for (const item of transfer.items) {
      const info = products.get(item.productId);
      try {
        await this.stock.apply(tx, {
          productId: item.productId,
          warehouseId: transfer.originWarehouseId,
          type: 'TRANSFER_OUT',
          quantity: -item.quantity,
          reason: `Transferencia ${transfer.number}`,
          refType: TRANSFER_REF_TYPE,
          refId: id,
          refNumber: transfer.number,
          unitCost: info?.cost ?? null,
        });
      } catch (err) {
        if (err instanceof UnprocessableEntityException && codeOf(err) === 'INSUFFICIENT_STOCK') {
          throw new UnprocessableEntityException({
            code: 'INSUFFICIENT_STOCK',
            message: 'Not enough stock in the origin warehouse',
            details: { lines: [{ productId: item.productId, sku: info?.sku ?? null, quantity: item.quantity }] },
          });
        }
        throw err;
      }
    }
  }

  /** Stores on each item the cost it left with. One statement for every line, not one round trip each: a transfer of hundreds of lines has to fit the transaction. */
  private async freezeItemCosts(tx: TenantTransaction, items: TransferToSend['items'], products: ReadonlyMap<string, ProductInfo>): Promise<void> {
    const costed = items.flatMap((item) => {
      const cost = products.get(item.productId)?.cost;
      return cost ? [Prisma.sql`(${item.id}::uuid, ${cost}::numeric)`] : [];
    });
    if (!costed.length) return;
    await tx.$executeRaw`
      UPDATE transfer_items AS t SET unit_cost = v.cost
      FROM (VALUES ${Prisma.join(costed)}) AS v(id, cost)
      WHERE t.id = v.id`;
  }

  /** Moves the transfer to IN_TRANSIT, freezing the totals it left with, and tells the rest of the system. */
  private async markSent(
    tx: TenantTransaction,
    ctx: { id: string; transfer: TransferToSend; from: TransferStatus; totals: TransferTotals; userId: string | null; companyId: string },
  ): Promise<void> {
    const { id, transfer, from, totals, userId, companyId } = ctx;
    const to = transferMachine.next(from, 'send');
    await tx.transfer.update({
      where: { id },
      data: { status: to, totalPieces: totals.pieces, totalValue: totals.value, sentById: userId, sentAt: new Date() },
    });
    await this.recordAudit(tx, {
      action: 'inventory.transfer.send',
      entity: 'Transfer',
      entityId: id,
      before: { status: from },
      after: {
        status: to,
        number: transfer.number,
        ...totals,
        origin: transfer.originWarehouseId,
        destination: transfer.destinationWarehouseId,
      },
    });
    await this.outbox.publish(
      'inventory.transfer.sent',
      {
        transferId: id,
        number: transfer.number,
        originWarehouseId: transfer.originWarehouseId,
        destinationWarehouseId: transfer.destinationWarehouseId,
        ...totals,
        userId,
      },
      { tx, companyId, idempotencyKey: `inventory.transfer.sent:${id}` },
    );
  }

  /** The origin warehouse of a search or a list must exist and be in a branch the member operates; otherwise it is not found. */
  private async assertOriginReadable(warehouseId: string): Promise<void> {
    const allowed = await this.operableBranches();
    const warehouse = await this.prisma.tenant.warehouse.findFirst({ where: { id: warehouseId }, select: { branchId: true } });
    if (!warehouse || (allowed && !allowed.includes(warehouse.branchId))) {
      throw new NotFoundException({ code: 'WAREHOUSE_NOT_FOUND', message: 'Warehouse not found' });
    }
  }

  /** Audit entry written in the transaction of the change. */
  private recordAudit(tx: TenantTransaction, entry: AuditEntry): Promise<void> {
    return this.audit.log(entry, tx as unknown as Prisma.TransactionClient);
  }

  /** Header and line rules shared by create and update: the warehouses, the limit, repeated or unknown products. */
  private async checkDraft(tx: TenantTransaction, dto: SaveTransferDto, allowed: string[] | null) {
    const maxLines = await this.settings.get('transfers.maxLines', tx);
    asHttpRule(() => assertTransferLineCount(dto.lines.length, maxLines));

    const productIds = dto.lines.map((l) => l.productId);
    if (new Set(productIds).size !== productIds.length) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid request', details: [{ field: 'lines', code: 'DUPLICATE_PRODUCT' }] });
    }

    const [origin, destination] = await Promise.all([
      tx.warehouse.findFirst({ where: { id: dto.originWarehouseId }, select: { id: true, status: true, branchId: true } }),
      tx.warehouse.findFirst({ where: { id: dto.destinationWarehouseId }, select: { id: true, status: true, branchId: true } }),
    ]);
    if (!origin || !destination) throw new NotFoundException({ code: 'WAREHOUSE_NOT_FOUND', message: 'Warehouse not found' });
    this.assertOperable(allowed, origin.branchId);
    asHttpRule(() =>
      assertTransferWarehouses({ id: origin.id, active: origin.status === 'ACTIVE' }, { id: destination.id, active: destination.status === 'ACTIVE' }),
    );

    const known = await tx.product.findMany({ where: { id: { in: productIds }, status: { not: 'DRAFT' } }, select: { id: true } });
    if (known.length !== productIds.length) {
      const knownIds = new Set(known.map((p) => p.id));
      throw new UnprocessableEntityException({
        code: 'PRODUCT_NOT_FOUND',
        message: 'Some products do not exist',
        details: { productIds: productIds.filter((p) => !knownIds.has(p)) },
      });
    }
    return { origin, destination };
  }

  /** Checks every line against the stock at the origin and totals them (cost and stock are read now). */
  private async validate(
    tx: TenantTransaction,
    originWarehouseId: string,
    lines: readonly { productId: string; quantity: number }[],
  ): Promise<{ validation: TransferValidation; products: Map<string, ProductInfo> }> {
    const ids = lines.map((l) => l.productId);
    const [rows, levels] = await Promise.all([
      tx.product.findMany({
        where: { id: { in: ids } },
        select: { id: true, sku: true, manufacturerCode: true, name: true, status: true, cost: true, brand: { select: { name: true } } },
      }),
      tx.stockLevel.findMany({ where: { warehouseId: originWarehouseId, productId: { in: ids } }, select: { productId: true, quantity: true } }),
    ]);
    const products = new Map<string, ProductInfo>(
      rows.map((p) => [
        p.id,
        {
          id: p.id,
          sku: p.sku,
          manufacturerCode: p.manufacturerCode,
          name: p.name,
          brand: p.brand.name,
          active: p.status === 'ACTIVE',
          cost: p.cost ? p.cost.toFixed(4) : null,
        },
      ]),
    );
    const available = new Map(levels.map((l) => [l.productId, l.quantity]));
    const validation = validateTransferLines(
      lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        unitCost: products.get(l.productId)?.cost ?? null,
        active: products.get(l.productId)?.active ?? false,
      })),
      available,
    );
    return { validation, products };
  }

  private async detail(tx: TenantTransaction, id: string, granted: ReadonlySet<string>): Promise<TransferDetail> {
    const t = await tx.transfer.findFirstOrThrow({
      where: { id },
      select: {
        id: true,
        number: true,
        status: true,
        note: true,
        totalPieces: true,
        totalValue: true,
        createdAt: true,
        updatedAt: true,
        sentAt: true,
        originWarehouseId: true,
        originWarehouse: { select: WAREHOUSE_SELECT },
        destinationWarehouse: { select: WAREHOUSE_SELECT },
        items: { select: { productId: true, quantity: true, receivedQuantity: true }, orderBy: [{ product: { manufacturerCode: 'asc' } }, { id: 'asc' }] },
      },
    });
    const { validation, products } = await this.validate(tx, t.originWarehouseId, t.items);
    const isDraft = t.status === 'DRAFT';
    const canViewCosts = granted.has('inventory.costs.view');

    // a sent transfer shows the totals frozen when it left, not today's costs
    const summary = isDraft
      ? validation.summary
      : { products: t.items.length, pieces: t.totalPieces, value: t.totalValue.toFixed(2), errors: 0, withoutCost: 0 };

    return {
      id: t.id,
      number: t.number,
      status: t.status,
      origin: t.originWarehouse,
      destination: t.destinationWarehouse,
      note: t.note,
      lines: t.items.map((item, i) => {
        const info = products.get(item.productId);
        const checked = validation.lines[i];
        return {
          productId: item.productId,
          sku: info?.sku ?? '',
          manufacturerCode: info?.manufacturerCode ?? '',
          name: info?.name ?? '',
          brand: info?.brand ?? '',
          quantity: item.quantity,
          receivedQuantity: item.receivedQuantity,
          available: checked.available,
          unitCost: canViewCosts ? (info?.cost ?? null) : null,
          status: isDraft ? checked.status : 'OK',
        };
      }),
      summary: { ...summary, value: canViewCosts ? summary.value : null, withoutCost: canViewCosts ? summary.withoutCost : null },
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      sentAt: t.sentAt?.toISOString() ?? null,
    };
  }

  /** The transfer, if one side of it is a branch the member may operate; otherwise it does not exist for them. */
  private async findVisible(tx: TenantTransaction, id: string, allowed: string[] | null) {
    const transfer = await tx.transfer.findFirst({
      where: { AND: [{ id }, visibleTo(allowed)] },
      select: { id: true, originWarehouse: { select: { branchId: true } }, items: { select: { id: true } } },
    });
    if (!transfer) throw new NotFoundException({ code: 'TRANSFER_NOT_FOUND', message: 'Transfer not found' });
    return transfer;
  }

  /** `FOR UPDATE` on the transfer row: a send, an edit and a cancel of the same transfer run one after the other. */
  private async lock(tx: TenantTransaction, id: string, companyId: string): Promise<{ status: TransferStatus; updatedAt: Date }> {
    const [row] = await tx.$queryRaw<{ status: string; updated_at: Date }[]>`
      SELECT status::text AS status, updated_at FROM transfers
      WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;
    if (!row) throw new NotFoundException({ code: 'TRANSFER_NOT_FOUND', message: 'Transfer not found' });
    return { status: row.status as TransferStatus, updatedAt: row.updated_at };
  }

  private assertFresh(updatedAt: Date, expected: string): void {
    if (updatedAt.getTime() !== new Date(expected).getTime()) {
      throw new ConflictException({ code: 'TRANSFER_MODIFIED', message: 'The transfer changed since it was read' });
    }
  }

  /**
   * Next `TR-` number of the company. The advisory lock serializes numbering per company until the transaction ends,
   * so two drafts never take the same number and a rolled-back one leaves no gap.
   */
  private async nextNumber(tx: TenantTransaction, companyId: string): Promise<string> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId}::text || ':transfer'))`;
    const last = await tx.$queryRaw<{ number: string }[]>`
      SELECT number FROM transfers
      WHERE company_id = ${companyId}::uuid AND number ~ '^TR-[0-9]{1,15}$'
      ORDER BY substring(number from 4)::bigint DESC LIMIT 1`;
    return formatTransferNumber((last[0] ? (parseTransferNumber(last[0].number) ?? 0) : 0) + 1);
  }

  private async granted(): Promise<ReadonlySet<string>> {
    const membershipId = this.cls.get('membershipId');
    return membershipId ? this.membership.permissions(membershipId) : new Set<string>();
  }

  /** Listing and opening a transfer is for those who create or receive transfers. */
  private async assertCanRead(): Promise<ReadonlySet<string>> {
    const granted = await this.granted();
    if (!granted.has('inventory.transfers.create') && !granted.has('inventory.transfers.receive')) {
      throw new ForbiddenException({ code: 'NO_PERMISSION', message: 'You do not have permission for this action' });
    }
    return granted;
  }

  private async assertCanWrite(): Promise<ReadonlySet<string>> {
    const granted = await this.granted();
    if (!granted.has('inventory.transfers.create')) {
      throw new ForbiddenException({ code: 'NO_PERMISSION', message: 'You do not have permission for this action', details: { missing: ['inventory.transfers.create'] } });
    }
    return granted;
  }

  /** Branches the member may operate; `null` means every branch. */
  private async operableBranches(): Promise<string[] | null> {
    const membershipId = this.cls.get('membershipId');
    return membershipId ? this.membership.operableBranchIds(membershipId) : [];
  }

  private assertOperable(allowed: string[] | null, branchId: string): void {
    if (allowed && !allowed.includes(branchId)) {
      throw new ForbiddenException({ code: 'BRANCH_FORBIDDEN', message: 'You cannot operate this branch' });
    }
  }

  private companyId(): string {
    const companyId = this.cls.get('companyId');
    if (!companyId) throw new Error('Transfer outside a company context');
    return companyId;
  }
}

/** A transfer is visible to a member who may operate the branch of its origin or of its destination. */
function visibleTo(allowed: string[] | null): Prisma.TransferWhereInput {
  return allowed ? { OR: [{ originWarehouse: { branchId: { in: allowed } } }, { destinationWarehouse: { branchId: { in: allowed } } }] } : {};
}

/** Business days are La Paz days (UTC-4, no daylight saving), not the server's. */
const LA_PAZ_OFFSET = '-04:00';

function dayStart(value: string): Date {
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00${LA_PAZ_OFFSET}` : value);
}

function nextDayStart(value: string): Date {
  const start = dayStart(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(start.getTime() + 24 * 60 * 60 * 1000) : start;
}

/** Runs a domain rule and turns the `TransferError` it throws into a 422 with the same code. */
function asHttpRule(rule: () => void): void {
  try {
    rule();
  } catch (err) {
    throw err instanceof TransferError ? new UnprocessableEntityException({ code: err.code, message: err.message }) : err;
  }
}

function invalidTransition(from: TransferStatus, event: string): UnprocessableEntityException {
  const err = new InvalidTransitionError(from, event);
  return new UnprocessableEntityException({ code: 'INVALID_TRANSITION', message: err.message, details: { from, event } });
}

function codeOf(err: UnprocessableEntityException): string | undefined {
  const body = err.getResponse();
  return typeof body === 'object' && body !== null && 'code' in body ? String((body as { code: unknown }).code) : undefined;
}

/**
 * The text of an uploaded list: an .xlsx gives its first sheet's first two columns, one `code<TAB>quantity` line per row;
 * anything else is read as CSV text, which `parseTransferPaste` splits the same way as a paste.
 */
async function readListFile(file: TransferUploadFile): Promise<string> {
  if (file.size > TRANSFER_FILE_MAX_BYTES || file.buffer.length > TRANSFER_FILE_MAX_BYTES) {
    throw new PayloadTooLargeException({ code: 'FILE_TOO_LARGE', message: 'The file is larger than the limit' });
  }
  if (file.buffer.length >= ZIP_MAGIC.length && file.buffer.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC)) {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException({ code: 'FILE_INVALID', message: 'The file cannot be read as an Excel workbook' });
    }
    const sheet = workbook.worksheets[0];
    if (!sheet || sheet.rowCount > SHEET_ROW_CEILING) {
      throw new BadRequestException({ code: 'FILE_INVALID', message: 'The sheet is empty or too long' });
    }
    const lines: string[] = [];
    for (let n = 1; n <= sheet.rowCount; n++) {
      const row = sheet.getRow(n);
      const [code, quantity] = [cellText(row.getCell(1).value), cellText(row.getCell(2).value)];
      if (code || quantity) lines.push(`${code}\t${quantity}`);
    }
    return lines.join('\n');
  }
  if (file.buffer.includes(0)) {
    throw new BadRequestException({ code: 'FILE_INVALID', message: 'Only .xlsx and .csv files are accepted' });
  }
  const text = file.buffer.toString('utf8');
  // a BOM is how Excel marks a UTF-8 CSV; it is not part of the first code
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** A cell as the text the user sees: numbers lose Excel's float noise, formulas give their result, rich text is joined. */
function cellText(value: ExcelJS.CellValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if ('richText' in value) return value.richText.map((part) => part.text).join('').trim();
  if ('result' in value) return cellText(value.result as ExcelJS.CellValue);
  if ('text' in value) return String(value.text).trim();
  return '';
}
