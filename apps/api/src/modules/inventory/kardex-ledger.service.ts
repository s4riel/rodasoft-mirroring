import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  clampPage,
  clampPageSize,
  KARDEX_PAGE_SIZE_DEFAULT,
  kardexCounterpartText,
  kardexDocumentLink,
  type KardexCounterpart,
  type KardexLedgerResponse,
  type KardexLedgerRow,
  kardexValue,
  movementPill,
  type StockMovementType,
  STOCK_MOVEMENT_TYPE_LABELS,
  TRANSFER_IN_TRANSIT_STATUSES,
  TRANSFER_RECEIPT_REF_TYPE,
  TRANSFER_REF_TYPE,
} from '@rodasoft/domain';
import ExcelJS from 'exceljs';
import { PrismaService, type TenantTransaction } from '../../common/prisma/prisma.service';
import type { KardexExportQueryDto, KardexQueryDto } from './kardex.dto';
import { formatLaPaz, KARDEX_EXPORT_MAX_ROWS, type KardexBaseScope, KardexService, safeText } from './kardex.service';

interface LedgerScope extends KardexBaseScope {
  type: StockMovementType | null;
  q: string | null;
}

interface LedgerRaw {
  id: string;
  created_at: Date;
  type: StockMovementType;
  quantity: number;
  balance_after: number;
  unit_cost: string | null;
  ref_type: string | null;
  ref_id: string | null;
  ref_number: string | null;
  warehouse_id: string;
  warehouse_name: string;
  branch_id: string;
  branch_name: string;
  user_name: string | null;
  product_id: string;
  manufacturer_code: string;
  product_name: string;
  brand_name: string;
  transfer_id: string | null;
  transfer_status: string | null;
  origin_warehouse_id: string | null;
  origin_warehouse_name: string | null;
  origin_branch_name: string | null;
  destination_warehouse_name: string | null;
  destination_branch_name: string | null;
}

interface LedgerTotals {
  total: number;
  quantity_in: number;
  quantity_out: number;
}

/**
 * The ledger of the kardex (IN-09 without a product): every movement of the warehouses in scope, newest first, each with the
 * balance of its product in its warehouse after it. It only reads. For a transfer it also names the other side, read from
 * the transfer document, since `stock_movements` only keeps the document number.
 */
@Injectable()
export class KardexLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kardex: KardexService,
  ) {}

  async ledger(query: KardexQueryDto): Promise<KardexLedgerResponse> {
    const page = clampPage(query.page);
    const pageSize = clampPageSize(query.pageSize ?? KARDEX_PAGE_SIZE_DEFAULT);
    const scope = await this.scopeOf(query);
    const { rows, totals } = await this.read(scope, { offset: (page - 1) * pageSize, limit: pageSize });
    return {
      filters: { warehouseId: query.warehouseId ?? null, branchId: query.branchId ?? null, type: scope.type, q: scope.q, from: scope.from, to: scope.to },
      includesCost: scope.includeCost,
      totals: { quantityIn: totals.quantity_in, quantityOut: totals.quantity_out, net: totals.quantity_in - totals.quantity_out },
      items: rows.map((r) => toLedgerRow(r, scope.includeCost)),
      total: totals.total,
      page,
      pageSize,
    };
  }

  /** The filtered ledger as an .xlsx, in the same order as the screen. */
  async export(query: KardexExportQueryDto): Promise<{ file: Buffer; name: string }> {
    const scope = await this.scopeOf(query);
    const { rows, totals } = await this.read(scope, { offset: 0, limit: KARDEX_EXPORT_MAX_ROWS + 1 });
    if (rows.length > KARDEX_EXPORT_MAX_ROWS) {
      throw new UnprocessableEntityException({ code: 'EXPORT_TOO_LARGE', message: 'Too many movements: export a shorter date range' });
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Kardex');
    sheet.addRow(['Período', `${scope.from} a ${scope.to}`]);
    sheet.addRow([]);
    const header = ['Fecha', 'Tipo', 'Movimiento', 'Documento', 'Producto', 'Sucursal', 'Almacén', 'Detalle', 'Usuario', 'Cantidad', 'Saldo'];
    if (scope.includeCost) header.push('Costo unit.', 'Valor');
    sheet.addRow(header).font = { bold: true };
    for (const raw of rows) {
      const r = toLedgerRow(raw, scope.includeCost);
      const line: (string | number)[] = [
        formatLaPaz(raw.created_at),
        r.pill === 'TRANSFER' ? 'Transferencia' : r.pill === 'IN' ? 'Entrada' : 'Salida',
        safeText(r.typeLabel),
        safeText(r.document.refNumber ?? ''),
        safeText(`${r.product.manufacturerCode} · ${r.product.name}`),
        safeText(r.branch.name),
        safeText(r.warehouse.name),
        safeText(r.counterpart ? kardexCounterpartText(r.counterpart) : ''),
        safeText(r.user ?? ''),
        r.quantity,
        r.balance,
      ];
      if (scope.includeCost) line.push(r.unitCost ?? '', r.value ?? '');
      sheet.addRow(line);
    }
    const total: (string | number)[] = ['', '', 'Total', `${totals.total} movimientos`, '', '', '', '', '', totals.quantity_in - totals.quantity_out, ''];
    sheet.addRow(total).font = { bold: true };
    return { file: Buffer.from(await workbook.xlsx.writeBuffer()), name: 'kardex-movimientos.xlsx' };
  }

  private async scopeOf(query: Pick<KardexQueryDto, 'warehouseId' | 'branchId' | 'from' | 'to' | 'type' | 'q'>): Promise<LedgerScope> {
    const base = await this.kardex.scopeOf(query);
    return { ...base, type: query.type ?? null, q: query.q?.trim() || null };
  }

  /** The movements and the totals of the same range, from one snapshot. */
  private async read(scope: LedgerScope, page: { offset: number; limit: number }) {
    return this.prisma.tenant.$transaction(
      async (tx) => {
        const [totals, rows] = await Promise.all([this.totals(tx, scope), this.rows(tx, scope, page)]);
        return { totals, rows };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  /** The conditions shared by the rows and the totals. Every one is on `m` (movements) or `p` (products), both of the company. */
  private where(s: LedgerScope): Prisma.Sql {
    const parts: Prisma.Sql[] = [
      Prisma.sql`m.company_id = ${s.companyId}::uuid`,
      Prisma.sql`m.warehouse_id = ANY(${s.warehouseIds}::uuid[])`,
      Prisma.sql`m.created_at >= ${s.fromAt}`,
      Prisma.sql`m.created_at < ${s.toExclusiveAt}`,
    ];
    if (s.type) parts.push(Prisma.sql`m.type::text = ${s.type}`);
    if (s.q) {
      // the text is data, not a pattern: LIKE wildcards in it are escaped
      const like = `%${s.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      parts.push(Prisma.sql`(m.ref_number ILIKE ${like} OR p.manufacturer_code ILIKE ${like} OR p.sku ILIKE ${like})`);
    }
    return Prisma.join(parts, ' AND ');
  }

  private async totals(tx: TenantTransaction, s: LedgerScope): Promise<LedgerTotals> {
    const [row] = await tx.$queryRaw<LedgerTotals[]>`
      SELECT
        COUNT(*)::int AS total,
        COALESCE(SUM(m.quantity) FILTER (WHERE m.quantity > 0), 0)::int AS quantity_in,
        COALESCE(-SUM(m.quantity) FILTER (WHERE m.quantity < 0), 0)::int AS quantity_out
      FROM stock_movements m
      JOIN products p ON p.id = m.product_id AND p.company_id = m.company_id
      WHERE ${this.where(s)}`;
    return row ?? { total: 0, quantity_in: 0, quantity_out: 0 };
  }

  private async rows(tx: TenantTransaction, s: LedgerScope, page: { offset: number; limit: number }): Promise<LedgerRaw[]> {
    return tx.$queryRaw<LedgerRaw[]>`
      SELECT m.id, m.created_at, m.type::text AS type, m.quantity, m.balance_after, m.unit_cost::text AS unit_cost,
        m.ref_type, m.ref_id, m.ref_number, m.warehouse_id, w.name AS warehouse_name, b.id AS branch_id, b.name AS branch_name,
        u.name AS user_name, p.id AS product_id, p.manufacturer_code, p.name AS product_name, br.name AS brand_name,
        t.id AS transfer_id, t.status::text AS transfer_status, t.origin_warehouse_id,
        ow.name AS origin_warehouse_name, ob.name AS origin_branch_name,
        dw.name AS destination_warehouse_name, db.name AS destination_branch_name
      FROM stock_movements m
      JOIN products p ON p.id = m.product_id AND p.company_id = m.company_id
      JOIN brands br ON br.id = p.brand_id AND br.company_id = m.company_id
      JOIN warehouses w ON w.id = m.warehouse_id AND w.company_id = m.company_id
      JOIN branches b ON b.id = w.branch_id AND b.company_id = m.company_id
      LEFT JOIN users u ON u.id = m.user_id
      LEFT JOIN transfer_receipts tr
        ON m.ref_type = ${TRANSFER_RECEIPT_REF_TYPE} AND tr.id = m.ref_id AND tr.company_id = m.company_id
      LEFT JOIN transfers t
        ON t.company_id = m.company_id
        AND t.id = CASE WHEN m.ref_type = ${TRANSFER_REF_TYPE} THEN m.ref_id WHEN m.ref_type = ${TRANSFER_RECEIPT_REF_TYPE} THEN tr.transfer_id END
      LEFT JOIN warehouses ow ON ow.id = t.origin_warehouse_id AND ow.company_id = t.company_id
      LEFT JOIN branches ob ON ob.id = ow.branch_id AND ob.company_id = t.company_id
      LEFT JOIN warehouses dw ON dw.id = t.destination_warehouse_id AND dw.company_id = t.company_id
      LEFT JOIN branches db ON db.id = dw.branch_id AND db.company_id = t.company_id
      WHERE ${this.where(s)}
      ORDER BY m.created_at DESC, m.id DESC
      OFFSET ${page.offset} LIMIT ${page.limit}`;
  }
}

/** The other side of a transfer movement, from the warehouse where it happened; `null` for anything else. */
function counterpartOf(r: LedgerRaw): KardexCounterpart | null {
  if (!r.transfer_id) return null;
  const here = r.warehouse_id === r.origin_warehouse_id;
  // pieces coming back to the origin (a cancelled transfer) were not sent anywhere
  if (here && r.quantity > 0) return null;
  const branch = here ? r.destination_branch_name : r.origin_branch_name;
  const warehouse = here ? r.destination_warehouse_name : r.origin_warehouse_name;
  if (!branch || !warehouse) return null;
  return {
    direction: here ? 'TO' : 'FROM',
    branch,
    warehouse,
    inTransit: (TRANSFER_IN_TRANSIT_STATUSES as readonly string[]).includes(r.transfer_status ?? ''),
  };
}

function toLedgerRow(r: LedgerRaw, includeCost: boolean): KardexLedgerRow {
  const row: KardexLedgerRow = {
    id: r.id,
    date: r.created_at.toISOString(),
    type: r.type,
    typeLabel: STOCK_MOVEMENT_TYPE_LABELS[r.type],
    pill: movementPill(r.type, r.quantity),
    document: { refType: r.ref_type, refNumber: r.ref_number },
    documentLink: kardexDocumentLink(r.ref_type, r.transfer_id, r.ref_id),
    product: { id: r.product_id, manufacturerCode: r.manufacturer_code, name: r.product_name, brand: r.brand_name },
    branch: { id: r.branch_id, name: r.branch_name },
    warehouse: { id: r.warehouse_id, name: r.warehouse_name },
    counterpart: counterpartOf(r),
    user: r.user_name,
    quantity: r.quantity,
    balance: r.balance_after,
  };
  if (includeCost) {
    row.unitCost = r.unit_cost;
    row.value = kardexValue(Math.abs(r.quantity), r.unit_cost);
  }
  return row;
}
