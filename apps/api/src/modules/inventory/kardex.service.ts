import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  clampPage,
  clampPageSize,
  defaultKardexRange,
  KARDEX_PAGE_SIZE_DEFAULT,
  kardexRangeError,
  kardexValue,
  type KardexResponse,
  type KardexRow,
  laPazToday,
  type StockMovementType,
  STOCK_MOVEMENT_TYPE_LABELS,
} from '@rodasoft/domain';
import ExcelJS from 'exceljs';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../../common/cls';
import { PrismaService, type TenantTransaction } from '../../common/prisma/prisma.service';
import { MembershipService } from '../access/membership.service';
import { dayStart, nextDayStart } from './business-days';
import type { KardexExportQueryDto, KardexQueryDto } from './kardex.dto';

/** Rows one export may hold; a longer history is exported in smaller date ranges. */
export const KARDEX_EXPORT_MAX_ROWS = 20_000;

/** What every kardex request resolves to before it reads: the company, the warehouses in scope and the date range. */
export interface KardexBaseScope {
  companyId: string;
  warehouseIds: string[];
  from: string;
  to: string;
  fromAt: Date;
  toExclusiveAt: Date;
  includeCost: boolean;
}

interface KardexScope extends KardexBaseScope {
  productId: string;
  /** The filter is one warehouse (or the scope holds only one): the balance column is that warehouse's `balance_after`. */
  singleWarehouse: boolean;
}

interface RawRow {
  id: string;
  created_at: Date;
  type: StockMovementType;
  quantity: number;
  balance_after: number;
  running: number;
  unit_cost: string | null;
  ref_type: string | null;
  ref_number: string | null;
  warehouse_id: string;
  warehouse_name: string;
  branch_id: string;
  branch_name: string;
  user_name: string | null;
}

interface RawTotals {
  total: number;
  quantity_in: number;
  quantity_out: number;
  value_in: string | null;
  value_out: string | null;
}

/**
 * Kardex of one product (HU-INV-24): the movements of `stock_movements` in time order with the balance after each one.
 * It only reads. The balance of a warehouse comes from `balance_after`, written with the movement under the stock lock;
 * the running total across warehouses is a window sum over the filtered range, so a later page carries on from the
 * earlier ones. Everything runs in one repeatable-read transaction so the rows, the totals and the stock levels agree.
 */
@Injectable()
export class KardexService {
  private readonly logger = new Logger(KardexService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly membership: MembershipService,
  ) {}

  async kardex(query: KardexQueryDto & { productId: string }): Promise<KardexResponse> {
    const page = clampPage(query.page);
    const pageSize = clampPageSize(query.pageSize ?? KARDEX_PAGE_SIZE_DEFAULT);
    const { scope, product } = await this.resolve(query);
    const { rows, totals, opening, levels } = await this.read(scope, { offset: (page - 1) * pageSize, limit: pageSize });

    const response: KardexResponse = {
      product: { ...product, currentStock: levels },
      filters: { warehouseId: query.warehouseId ?? null, from: scope.from, to: scope.to },
      openingBalance: opening,
      totals: {
        quantityIn: totals.quantity_in,
        quantityOut: totals.quantity_out,
        closingBalance: opening + totals.quantity_in - totals.quantity_out,
        ...(scope.includeCost ? { valueIn: totals.value_in ?? '0.00', valueOut: totals.value_out ?? '0.00' } : {}),
      },
      includesCost: scope.includeCost,
      items: rows.map((r) => toRow(r, scope)),
      total: totals.total,
      page,
      pageSize,
    };
    this.checkReconciliation(scope, response, levels);
    return response;
  }

  /** The whole range as an .xlsx, in the same order and with the same columns as the screen. */
  async export(query: KardexExportQueryDto & { productId: string }): Promise<{ file: Buffer; name: string }> {
    const { scope, product } = await this.resolve(query);
    const { rows, totals, opening } = await this.read(scope, { offset: 0, limit: KARDEX_EXPORT_MAX_ROWS + 1 });
    if (rows.length > KARDEX_EXPORT_MAX_ROWS) {
      throw new UnprocessableEntityException({ code: 'EXPORT_TOO_LARGE', message: 'Too many movements: export a shorter date range' });
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Kardex');
    sheet.addRow(['Producto', safeText(`${product.manufacturerCode} · ${product.name}`)]);
    sheet.addRow(['Marca', safeText(product.brand)]);
    sheet.addRow(['Período', `${scope.from} a ${scope.to}`]);
    sheet.addRow([]);
    const header = ['Fecha', 'Tipo', 'Documento', 'Sucursal', 'Almacén', 'Usuario', 'Entrada', 'Salida', 'Saldo'];
    if (scope.includeCost) header.push('Costo unit.', 'Valor entrada', 'Valor salida', 'Valor saldo');
    sheet.addRow(header).font = { bold: true };

    const blank = scope.includeCost ? ['', '', '', ''] : [];
    sheet.addRow(['', 'Saldo inicial', '', '', '', '', '', '', opening, ...blank]);
    for (const raw of rows) {
      const r = toRow(raw, scope);
      const line: (string | number | null)[] = [
        formatLaPaz(raw.created_at),
        r.typeLabel,
        safeText([r.document.refType, r.document.refNumber].filter(Boolean).join(' ')),
        safeText(r.branch.name),
        safeText(r.warehouse.name),
        safeText(r.user ?? ''),
        r.quantityIn || null,
        r.quantityOut || null,
        r.balance,
      ];
      if (scope.includeCost) line.push(r.unitCost ?? '', r.valueIn ?? '', r.valueOut ?? '', r.balanceValue ?? '');
      sheet.addRow(line);
    }
    const totalsLine: (string | number)[] = ['', 'Saldo final', '', '', '', '', totals.quantity_in, totals.quantity_out, opening + totals.quantity_in - totals.quantity_out];
    if (scope.includeCost) totalsLine.push('', totals.value_in ?? '0.00', totals.value_out ?? '0.00', '');
    sheet.addRow(totalsLine).font = { bold: true };

    const code = product.manufacturerCode.replace(/[^A-Za-z0-9._-]+/g, '_');
    return { file: Buffer.from(await workbook.xlsx.writeBuffer()), name: `kardex-${code}.xlsx` };
  }

  // ── Scope ──────────────────────────────────────────────────────────────────

  /** Company, cost permission, date range and warehouses: what the kardex of a product and the ledger share. */
  async scopeOf(query: Pick<KardexQueryDto, 'warehouseId' | 'branchId' | 'from' | 'to'>): Promise<KardexBaseScope> {
    const granted = await this.granted();
    const companyId = this.cls.get('companyId');
    if (!companyId) throw new ForbiddenException({ code: 'COMPANY_REQUIRED', message: 'Company required' });

    const defaults = defaultKardexRange(new Date());
    const from = query.from ?? defaults.from;
    const to = query.to ?? defaults.to;
    const rangeError = kardexRangeError({ from, to });
    if (rangeError) {
      throw new BadRequestException({ code: 'INVALID_FILTER', message: 'Invalid date range', details: [{ field: 'from', code: rangeError }] });
    }

    const warehouseIds = await this.warehouseScope(query);
    return {
      companyId,
      warehouseIds,
      from,
      to,
      fromAt: dayStart(from),
      toExclusiveAt: nextDayStart(to),
      includeCost: granted.has('inventory.costs.view'),
    };
  }

  private async resolve(query: KardexExportQueryDto & { productId: string }) {
    const base = await this.scopeOf(query);
    const product = await this.prisma.tenant.product.findFirst({
      where: { id: query.productId },
      select: { id: true, sku: true, manufacturerCode: true, name: true, unit: true, brand: { select: { name: true } } },
    });
    if (!product) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });

    const scope: KardexScope = { ...base, productId: product.id, singleWarehouse: base.warehouseIds.length === 1 };
    return {
      scope,
      product: {
        id: product.id,
        sku: product.sku,
        manufacturerCode: product.manufacturerCode,
        name: product.name,
        brand: product.brand.name,
        unit: product.unit,
      },
    };
  }

  /**
   * The warehouses the kardex covers: the one requested, or those of the requested branch, intersected with the branches
   * the member may operate. A warehouse the member cannot see does not exist for them.
   */
  private async warehouseScope(query: Pick<KardexQueryDto, 'warehouseId' | 'branchId'>): Promise<string[]> {
    const membershipId = this.cls.get('membershipId');
    const allowed = membershipId ? await this.membership.operableBranchIds(membershipId) : [];

    if (query.branchId) {
      const branch = await this.prisma.tenant.branch.findFirst({ where: { id: query.branchId }, select: { id: true } });
      if (!branch) throw new NotFoundException({ code: 'BRANCH_NOT_FOUND', message: 'Branch not found' });
      if (allowed && !allowed.includes(query.branchId)) {
        throw new ForbiddenException({ code: 'BRANCH_NOT_ALLOWED', message: 'You cannot operate this branch' });
      }
    }

    const warehouses = await this.prisma.tenant.warehouse.findMany({
      where: {
        ...(query.warehouseId ? { id: query.warehouseId } : {}),
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(allowed ? { branchId: query.branchId ? { equals: query.branchId, in: allowed } : { in: allowed } } : {}),
      },
      select: { id: true },
    });
    if (query.warehouseId && warehouses.length === 0) {
      throw new NotFoundException({ code: 'WAREHOUSE_NOT_FOUND', message: 'Warehouse not found' });
    }
    return warehouses.map((w) => w.id);
  }

  private async granted(): Promise<ReadonlySet<string>> {
    const membershipId = this.cls.get('membershipId');
    return membershipId ? this.membership.permissions(membershipId) : new Set<string>();
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  /** Opening balance, totals of the range, the page of rows and the stock levels, all from one snapshot. */
  private async read(scope: KardexScope, page: { offset: number; limit: number }) {
    return this.prisma.tenant.$transaction(
      async (tx) => {
        const opening = await this.openingBalance(tx, scope);
        const [totals, rows, levels] = await Promise.all([this.totals(tx, scope), this.rows(tx, scope, opening, page), this.levels(tx, scope)]);
        return { opening, totals, rows, levels };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  /**
   * Stock in the scope just before `from`: the sum of the quantities moved before it. Summing does not depend on the
   * order of `created_at`, which is stamped before a movement takes its stock lock, so two concurrent movements can be
   * written in the opposite order and "the last balance_after" would pick the wrong one.
   */
  private async openingBalance(tx: TenantTransaction, s: KardexScope): Promise<number> {
    const [row] = await tx.$queryRaw<{ opening: number }[]>`
      SELECT COALESCE(SUM(quantity), 0)::int AS opening
      FROM stock_movements
      WHERE company_id = ${s.companyId}::uuid AND product_id = ${s.productId}::uuid
        AND warehouse_id = ANY(${s.warehouseIds}::uuid[]) AND created_at < ${s.fromAt}`;
    return row?.opening ?? 0;
  }

  /** Inflows, outflows and (valued at each movement's unit cost, cents per row) their value over the whole range. */
  private async totals(tx: TenantTransaction, s: KardexScope): Promise<RawTotals> {
    const [row] = await tx.$queryRaw<RawTotals[]>`
      SELECT
        COUNT(*)::int AS total,
        COALESCE(SUM(quantity) FILTER (WHERE quantity > 0), 0)::int AS quantity_in,
        COALESCE(-SUM(quantity) FILTER (WHERE quantity < 0), 0)::int AS quantity_out,
        SUM(ROUND(quantity * unit_cost, 2)) FILTER (WHERE quantity > 0 AND unit_cost IS NOT NULL)::text AS value_in,
        SUM(ROUND(-quantity * unit_cost, 2)) FILTER (WHERE quantity < 0 AND unit_cost IS NOT NULL)::text AS value_out
      FROM stock_movements
      WHERE company_id = ${s.companyId}::uuid AND product_id = ${s.productId}::uuid
        AND warehouse_id = ANY(${s.warehouseIds}::uuid[])
        AND created_at >= ${s.fromAt} AND created_at < ${s.toExclusiveAt}`;
    return row ?? { total: 0, quantity_in: 0, quantity_out: 0, value_in: null, value_out: null };
  }

  /**
   * The rows in time order (`created_at`, then the uuid v7 `id`, so the write order). The window sum runs over the whole
   * filtered range before OFFSET/LIMIT, so page 2 continues from page 1's last balance.
   */
  private async rows(tx: TenantTransaction, s: KardexScope, opening: number, page: { offset: number; limit: number }): Promise<RawRow[]> {
    return tx.$queryRaw<RawRow[]>`
      SELECT m.id, m.created_at, m.type::text AS type, m.quantity, m.balance_after, m.unit_cost::text AS unit_cost,
        m.ref_type, m.ref_number, m.warehouse_id, w.name AS warehouse_name, b.id AS branch_id, b.name AS branch_name,
        u.name AS user_name,
        (${opening}::int + SUM(m.quantity) OVER (ORDER BY m.created_at, m.id))::int AS running
      FROM stock_movements m
      JOIN warehouses w ON w.id = m.warehouse_id AND w.company_id = m.company_id
      JOIN branches b ON b.id = w.branch_id AND b.company_id = m.company_id
      LEFT JOIN users u ON u.id = m.user_id
      WHERE m.company_id = ${s.companyId}::uuid AND m.product_id = ${s.productId}::uuid
        AND m.warehouse_id = ANY(${s.warehouseIds}::uuid[])
        AND m.created_at >= ${s.fromAt} AND m.created_at < ${s.toExclusiveAt}
      ORDER BY m.created_at, m.id
      OFFSET ${page.offset} LIMIT ${page.limit}`;
  }

  private async levels(tx: TenantTransaction, s: KardexScope): Promise<number> {
    const [row] = await tx.$queryRaw<{ quantity: number }[]>`
      SELECT COALESCE(SUM(quantity), 0)::int AS quantity FROM stock_levels
      WHERE company_id = ${s.companyId}::uuid AND product_id = ${s.productId}::uuid
        AND warehouse_id = ANY(${s.warehouseIds}::uuid[])`;
    return row?.quantity ?? 0;
  }

  /**
   * When the range reaches today the closing balance is the stock right now, so it must equal the stock levels. A mismatch
   * means a stock change bypassed the movements service; it is logged (and fails the integration tests) rather than hidden,
   * but the kardex is still returned so it can be used to find the gap.
   */
  private checkReconciliation(s: KardexScope, response: KardexResponse, levels: number): void {
    if (s.to < laPazToday(new Date())) return;
    if (response.totals.closingBalance === levels) return;
    const detail = `kardex closing balance ${response.totals.closingBalance} differs from stock_levels ${levels} (product ${s.productId})`;
    this.logger.error(detail);
    if (process.env['NODE_ENV'] === 'test') throw new InternalServerErrorException({ code: 'KARDEX_MISMATCH', message: detail });
  }
}

function toRow(r: RawRow, s: KardexScope): KardexRow {
  const balance = s.singleWarehouse ? r.balance_after : r.running;
  const row: KardexRow = {
    id: r.id,
    date: r.created_at.toISOString(),
    type: r.type,
    typeLabel: STOCK_MOVEMENT_TYPE_LABELS[r.type],
    document: { refType: r.ref_type, refNumber: r.ref_number },
    branch: { id: r.branch_id, name: r.branch_name },
    warehouse: { id: r.warehouse_id, name: r.warehouse_name },
    user: r.user_name,
    quantityIn: Math.max(r.quantity, 0),
    quantityOut: Math.max(-r.quantity, 0),
    balance,
    warehouseBalance: r.balance_after,
  };
  if (s.includeCost) {
    row.unitCost = r.unit_cost;
    row.valueIn = r.quantity > 0 ? kardexValue(r.quantity, r.unit_cost) : null;
    row.valueOut = r.quantity < 0 ? kardexValue(-r.quantity, r.unit_cost) : null;
    row.balanceValue = kardexValue(balance, r.unit_cost);
  }
  return row;
}

/** A text cell that Excel cannot read as a formula: a leading `=`, `+`, `-` or `@` gets a quote in front. */
export function safeText(value: string): string {
  return value !== '' && '=+-@'.includes(value.charAt(0)) ? `'${value}` : value;
}

/** `2026-10-29 14:05` in La Paz time (UTC−4, no daylight saving). */
export function formatLaPaz(date: Date): string {
  return new Date(date.getTime() - 4 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ');
}
