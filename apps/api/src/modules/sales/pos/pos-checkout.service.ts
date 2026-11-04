import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  availableQuantity,
  cartTotals,
  lineTotal,
  maxSellable,
  type CurrentCashShift,
  type PosCheckoutResponse,
  type PosCheckoutView,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../../../common/cls';
import { PrismaService, type TenantTransaction } from '../../../common/prisma/prisma.service';
import { SettingsService } from '../../../common/settings/settings.service';
import { CashShiftsService } from '../cash/cash-shifts.service';
import type { AddPosCheckoutItemDto, UpdatePosCheckoutItemDto } from './pos.dto';
import { assertQuantity, posErrors } from './pos.errors';

const checkoutWithLines = (warehouseId: string) =>
  ({
    items: {
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: {
        product: {
          select: {
            manufacturerCode: true,
            name: true,
            brand: { select: { name: true } },
            stockLevels: { where: { warehouseId }, select: { quantity: true, reserved: true } },
          },
        },
      },
    },
  }) satisfies Prisma.PosCheckoutInclude;

/** The tenant client, or the tenant client of a transaction. */
type TenantDb = TenantTransaction | PrismaService['tenant'];

type CheckoutWithLines = Prisma.PosCheckoutGetPayload<{ include: ReturnType<typeof checkoutWithLines> }>;

/**
 * The cashier's server-side cart (HU-VEN-02): one `OPEN` cart per cashier (partial unique index), one line per product.
 * Cart edits are drafts, so they are neither audited nor published; HU-VEN-07/11 audit the sale. Stock is only read here,
 * never written nor locked: HU-VEN-11 locks `StockLevel` when the sale is completed.
 */
@Injectable()
export class PosCheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly shifts: CashShiftsService,
    private readonly settings: SettingsService,
  ) {}

  /** My `OPEN` cart, or `null`. */
  async current(): Promise<PosCheckoutResponse> {
    const shift = await this.shifts.requireOpenShift();
    const checkout = await this.prisma.tenant.posCheckout.findFirst({
      where: { cashierId: this.userId(), status: 'OPEN' },
      include: checkoutWithLines(shift.warehouse.id),
    });
    return { checkout: checkout ? await this.toView(checkout, this.prisma.tenant) : null };
  }

  /** Adds the product, or raises the quantity of its line. Creates the cart on the first add. */
  async addItem(dto: AddPosCheckoutItemDto): Promise<PosCheckoutResponse> {
    assertQuantity(dto.quantity);
    const shift = await this.shifts.requireOpenShift();
    const checkoutId = await this.ensureCheckout(shift);

    return this.prisma.tenant.$transaction(async (tx) => {
      await this.lockEditable(tx, checkoutId);
      const product = await tx.product.findFirst({
        where: { id: dto.productId, status: { not: 'DRAFT' } },
        select: { id: true, status: true, salePrice: true },
      });
      if (!product) throw posErrors.productNotFound();
      if (product.status !== 'ACTIVE') throw posErrors.productInactive();

      const line = await tx.posCheckoutItem.findFirst({
        where: { checkoutId, productId: product.id },
        select: { id: true, quantity: true },
      });
      const quantity = (line?.quantity ?? 0) + dto.quantity;
      await this.assertStock(tx, shift, product.id, quantity);

      if (line) {
        await tx.posCheckoutItem.update({ where: { id: line.id }, data: { quantity } });
      } else {
        const last = await tx.posCheckoutItem.aggregate({ where: { checkoutId }, _max: { sortOrder: true } });
        await tx.posCheckoutItem.create({
          data: {
            companyId: this.companyId(),
            checkoutId,
            productId: product.id,
            quantity,
            // the price is copied when the product is added; HU-VEN-07 checks it again before payment
            unitPrice: product.salePrice,
            sortOrder: (last._max.sortOrder ?? -1) + 1,
          },
        });
      }
      return this.load(tx, checkoutId, shift);
    });
  }

  /** Changes the quantity of one of my lines. */
  async updateItem(itemId: string, dto: UpdatePosCheckoutItemDto): Promise<PosCheckoutResponse> {
    assertQuantity(dto.quantity);
    const { quantity } = dto;
    const shift = await this.shifts.requireOpenShift();
    return this.prisma.tenant.$transaction(async (tx) => {
      const line = await this.findMyLine(tx, itemId);
      await this.lockEditable(tx, line.checkoutId);
      await this.assertStock(tx, shift, line.productId, quantity);
      await tx.posCheckoutItem.update({ where: { id: line.id }, data: { quantity } });
      return this.load(tx, line.checkoutId, shift);
    });
  }

  /** Removes one of my lines. An empty cart stays `OPEN`. */
  async removeItem(itemId: string): Promise<PosCheckoutResponse> {
    const shift = await this.shifts.requireOpenShift();
    return this.prisma.tenant.$transaction(async (tx) => {
      const line = await this.findMyLine(tx, itemId);
      await this.lockEditable(tx, line.checkoutId);
      await tx.posCheckoutItem.delete({ where: { id: line.id } });
      return this.load(tx, line.checkoutId, shift);
    });
  }

  /**
   * My `OPEN` cart's id, creating it when there is none. Runs outside the write transaction: a unique violation aborts a
   * Postgres transaction, so the loser of two concurrent first adds reads the winner's cart here instead.
   */
  private async ensureCheckout(shift: CurrentCashShift): Promise<string> {
    const cashierId = this.userId();
    const find = () => this.prisma.tenant.posCheckout.findFirst({ where: { cashierId, status: 'OPEN' }, select: { id: true, shiftId: true } });
    const adopt = async (cart: { id: string; shiftId: string }) => {
      // an open cart left from a closed shift now belongs to the shift the cashier works in (the sale links to it, HU-VEN-07)
      if (cart.shiftId !== shift.id) await this.prisma.tenant.posCheckout.update({ where: { id: cart.id }, data: { shiftId: shift.id } });
      return cart.id;
    };
    const existing = await find();
    if (existing) return adopt(existing);
    try {
      const created = await this.prisma.tenant.posCheckout.create({
        data: { companyId: this.companyId(), cashierId, shiftId: shift.id },
        select: { id: true },
      });
      return created.id;
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      const winner = await find();
      if (!winner) throw err;
      return adopt(winner);
    }
  }

  /** `FOR UPDATE` on my cart row, so `sort_order` and the quantities stay consistent; then it must still be `OPEN`. */
  private async lockEditable(tx: TenantTransaction, checkoutId: string): Promise<void> {
    const rows = await tx.$queryRaw<{ status: string }[]>`
      SELECT status FROM pos_checkouts WHERE id = ${checkoutId}::uuid AND company_id = ${this.companyId()}::uuid FOR UPDATE`;
    if (rows[0]?.status !== 'OPEN') throw posErrors.notEditable();
  }

  /** A line of one of my carts; another cashier's line does not exist for me. */
  private async findMyLine(tx: TenantTransaction, itemId: string) {
    const line = await tx.posCheckoutItem.findFirst({
      where: { id: itemId, checkout: { cashierId: this.userId() } },
      select: { id: true, checkoutId: true, productId: true },
    });
    if (!line) throw posErrors.itemNotFound();
    return line;
  }

  /** Refuses more than the available stock of the register's warehouse, unless negative stock is allowed. */
  private async assertStock(tx: TenantTransaction, shift: CurrentCashShift, productId: string, quantity: number): Promise<void> {
    if (await this.settings.get('inventory.allowNegativeStock', tx)) return;
    const level = await tx.stockLevel.findFirst({
      where: { productId, warehouseId: shift.warehouse.id },
      select: { quantity: true, reserved: true },
    });
    const available = availableQuantity(level);
    if (quantity > available) throw posErrors.insufficientStock(Math.max(0, available));
  }

  private async load(tx: TenantTransaction, checkoutId: string, shift: CurrentCashShift): Promise<PosCheckoutResponse> {
    const checkout = await tx.posCheckout.findFirstOrThrow({ where: { id: checkoutId }, include: checkoutWithLines(shift.warehouse.id) });
    return { checkout: await this.toView(checkout, tx) };
  }

  private async toView(checkout: CheckoutWithLines, db: TenantDb): Promise<PosCheckoutView> {
    const [roundingMode, allowNegative] = await Promise.all([
      this.settings.get('sales.roundingMode', db),
      this.settings.get('inventory.allowNegativeStock', db),
    ]);
    const lines = checkout.items.map((item) => {
      const unitPrice = item.unitPrice.toFixed(2);
      return {
        id: item.id,
        productId: item.productId,
        code: item.product.manufacturerCode,
        name: item.product.name,
        brandName: item.product.brand.name,
        quantity: item.quantity,
        unitPrice,
        lineTotal: lineTotal(unitPrice, item.quantity).toString(),
        maxQuantity: maxSellable(availableQuantity(item.product.stockLevels[0]), allowNegative),
        sortOrder: item.sortOrder,
      };
    });
    // the customer discount comes with HU-VEN-05/37; until then a cart has none
    const pricing: PosCheckoutView['pricing'] = { roundingMode, discount: null };
    const totals = cartTotals(lines, pricing);
    return {
      id: checkout.id,
      status: checkout.status,
      lines,
      pricing,
      subtotal: totals.subtotal.toString(),
      discount: totals.discount.toString(),
      total: totals.total.toString(),
    };
  }

  private companyId(): string {
    const companyId = this.cls.get('companyId');
    if (!companyId) throw new Error('POS cart outside a company context');
    return companyId;
  }

  private userId(): string {
    const userId = this.cls.get('userId');
    if (!userId) throw new Error('POS cart outside a user context');
    return userId;
  }
}
