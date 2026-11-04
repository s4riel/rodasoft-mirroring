import { Injectable } from '@nestjs/common';
import {
  availableQuantity,
  brandInitials,
  type PosEquivalentItem,
  type PosEquivalentKind,
  type PosEquivalentsResponse,
  type PosOtherBranchStock,
} from '@rodasoft/domain';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { EquivalencesService } from '../../inventory/equivalences.service';
import { CashShiftsService } from '../cash/cash-shifts.service';

/**
 * Equivalents of an out-of-stock product (HU-VEN-03, VP-03b). The links and their comparison come from the inventory
 * (`EquivalencesService`); this adds what the cashier needs: only active, approved, compatible products that have stock in
 * the warehouse of their register, and where else the original is in stock. Read only: it never writes stock, audit or
 * outbox, and never returns costs. Adding an equivalent to the cart is the HU-VEN-02 endpoint.
 */
@Injectable()
export class PosEquivalentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shifts: CashShiftsService,
    private readonly equivalences: EquivalencesService,
  ) {}

  async list(productId: string): Promise<PosEquivalentsResponse> {
    const shift = await this.shifts.requireOpenShift();
    const { source, items } = await this.equivalences.comparedEquivalents(productId, { approvedOnly: true });
    const candidates = items.filter(
      (c): c is typeof c & { kind: PosEquivalentKind } => c.kind !== 'INCOMPATIBLE' && c.product.status === 'ACTIVE',
    );

    const [levels, otherLevels] = await Promise.all([
      this.prisma.tenant.stockLevel.findMany({
        where: { warehouseId: shift.warehouse.id, productId: { in: [source.id, ...candidates.map((c) => c.product.id)] } },
        select: { productId: true, quantity: true, reserved: true },
      }),
      this.prisma.tenant.stockLevel.findMany({
        where: {
          productId: source.id,
          warehouse: { status: 'ACTIVE', branchId: { not: shift.branch.id }, branch: { status: 'ACTIVE' } },
        },
        select: { quantity: true, reserved: true, warehouse: { select: { branch: { select: { id: true, name: true } } } } },
      }),
    ]);
    const availableOf = new Map(levels.map((l) => [l.productId, availableQuantity(l)]));

    const offered = candidates
      .map((candidate) => toPosItem(candidate, availableOf.get(candidate.product.id) ?? 0))
      .filter((item) => item.available > 0)
      .sort(
        (a, b) =>
          Number(b.kind === 'EXACT') - Number(a.kind === 'EXACT') ||
          b.available - a.available ||
          a.code.localeCompare(b.code) ||
          a.productId.localeCompare(b.productId),
      );

    return {
      original: { id: source.id, code: source.manufacturerCode, available: availableOf.get(source.id) ?? 0 },
      warehouse: { id: shift.warehouse.id, name: shift.warehouse.name },
      items: offered,
      otherBranches: otherBranchesOf(otherLevels),
    };
  }
}

type Candidate = Awaited<ReturnType<EquivalencesService['comparedEquivalents']>>['items'][number] & { kind: PosEquivalentKind };

function toPosItem({ product, link, kind, differences }: Candidate, available: number): PosEquivalentItem {
  const { dimensions } = product;
  return {
    productId: product.id,
    code: product.manufacturerCode,
    name: product.name,
    brand: { name: product.brand.name, initials: brandInitials(product.brand.name) },
    salePrice: product.salePrice.toFixed(2),
    available,
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
}

/** The original's stock per branch (a branch may have several warehouses), without empty branches, highest first. */
function otherBranchesOf(
  levels: { quantity: number; reserved: number; warehouse: { branch: { id: string; name: string } } }[],
): PosOtherBranchStock[] {
  const byBranch = new Map<string, PosOtherBranchStock>();
  for (const level of levels) {
    const { id, name } = level.warehouse.branch;
    const entry = byBranch.get(id) ?? { branchName: name, available: 0 };
    // an oversold warehouse (negative stock allowed) must not hide the stock of another warehouse of the branch
    entry.available += Math.max(0, availableQuantity(level));
    byBranch.set(id, entry);
  }
  return [...byBranch.values()]
    .filter((b) => b.available > 0)
    .sort((a, b) => b.available - a.available || a.branchName.localeCompare(b.branchName));
}
