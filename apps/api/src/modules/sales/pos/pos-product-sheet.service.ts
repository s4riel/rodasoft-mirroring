import { Injectable } from '@nestjs/common';
import {
  availableQuantity,
  brandInitials,
  isSellable,
  maxSellable,
  stockStatus,
  type PosEquivalentItem,
  type PosEquivalentKind,
  type PosProductSheet,
} from '@rodasoft/domain';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SettingsService } from '../../../common/settings/settings.service';
import { EquivalencesService } from '../../inventory/equivalences.service';
import { ProductsService } from '../../inventory/products.service';
import { CashShiftsService } from '../cash/cash-shifts.service';
import { posErrors } from './pos.errors';

/**
 * Technical sheet of a product inside the POS (HU-VEN-04, VP-03e). The sheet itself comes from the inventory
 * (`ProductsService.detail`), always asked without costs: a cashier never sees cost or margin, whatever permissions their role
 * has. This adds the stock of the register's warehouse and the product's equivalents. Read only: it never writes stock, audit
 * or outbox; adding to the sale is the HU-VEN-02 endpoint.
 */
@Injectable()
export class PosProductSheetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shifts: CashShiftsService,
    private readonly settings: SettingsService,
    private readonly products: ProductsService,
    private readonly equivalences: EquivalencesService,
  ) {}

  async sheet(productId: string): Promise<PosProductSheet> {
    const shift = await this.shifts.requireOpenShift();
    const detail = await this.products.detail(productId, false);
    // an inactive product is not sold, so for the POS it does not exist
    if (!isSellable(detail.status)) throw posErrors.productNotFound();

    const { items } = await this.equivalences.comparedEquivalents(productId, { approvedOnly: true });
    // inactive equivalents cannot be sold nor opened from the sheet, so they are not listed
    const candidates = items.filter(
      (c): c is typeof c & { kind: PosEquivalentKind } => c.kind !== 'INCOMPATIBLE' && c.product.status === 'ACTIVE',
    );

    const [levels, thresholds, allowNegative] = await Promise.all([
      this.prisma.tenant.stockLevel.findMany({
        where: { warehouseId: shift.warehouse.id, productId: { in: [productId, ...candidates.map((c) => c.product.id)] } },
        select: { productId: true, quantity: true, reserved: true },
      }),
      this.prisma.tenant.stockThreshold.findFirst({
        where: { warehouseId: shift.warehouse.id, productId },
        select: { minStock: true },
      }),
      this.settings.get('inventory.allowNegativeStock'),
    ]);
    const availableOf = new Map(levels.map((l) => [l.productId, availableQuantity(l)]));
    const available = availableOf.get(productId) ?? 0;

    const equivalents = candidates
      .map(({ product, link, kind, differences }): PosEquivalentItem => {
        const { dimensions } = product;
        return {
          productId: product.id,
          code: product.manufacturerCode,
          name: product.name,
          brand: { name: product.brand.name, initials: brandInitials(product.brand.name) },
          salePrice: product.salePrice.toFixed(2),
          available: availableOf.get(product.id) ?? 0,
          kind,
          differences,
          substitute: link.substitute,
          notes: link.notes,
          measures: dimensions
            ? {
                innerDiameter: dimensions.innerDiameter?.toString() ?? null,
                outerDiameter: dimensions.outerDiameter?.toString() ?? null,
                width: dimensions.width?.toString() ?? null,
              }
            : null,
        };
      })
      .sort(
        (a, b) =>
          Number(b.kind === 'EXACT') - Number(a.kind === 'EXACT') ||
          b.available - a.available ||
          a.code.localeCompare(b.code) ||
          a.productId.localeCompare(b.productId),
      );

    // picked field by field: nothing of `pricing.cost`, the audit actors or the internal supplier can leak by accident
    return {
      product: {
        id: detail.id,
        sku: detail.sku,
        manufacturerCode: detail.manufacturerCode,
        name: detail.name,
        unit: detail.unit,
        status: detail.status,
        brand: detail.brand,
        country: detail.country,
        category: detail.category,
        subcategory: detail.subcategory,
        dimensions: detail.dimensions,
        specs: detail.specs,
        salePrice: detail.pricing.salePrice,
        sectors: detail.extra.sectors ? detail.extra.sectors.split(',').map((s) => s.trim()).filter(Boolean) : [],
        totalStock: detail.totalStock,
        stockByBranch: detail.stockByBranch,
        photos: detail.photos,
        datasheetUrl: detail.datasheetUrl,
      },
      available,
      stockStatus: stockStatus(available, thresholds?.minStock ?? null),
      maxQuantity: maxSellable(available, allowNegative),
      warehouse: { id: shift.warehouse.id, name: shift.warehouse.name },
      branchId: shift.branch.id,
      equivalents,
    };
  }
}
