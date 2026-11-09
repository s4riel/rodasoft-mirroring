/**
 * Shared setup of the POS integration specs (HU-VEN-02) against the real Postgres: two companies, a register with its
 * warehouse, cashiers with open shifts, and products whose stock is loaded through `StockMovementService`, the only path
 * that writes stock.
 */
import { PrismaClient } from '@prisma/client';
import { normalizePair } from '@rodasoft/domain';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../../common/audit/audit.service';
import { OutboxService } from '../../../common/outbox/outbox.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { tenantExtension } from '../../../common/prisma/tenant.extension';
import { SettingsService } from '../../../common/settings/settings.service';
import { EquivalencesService } from '../../inventory/equivalences.service';
import { ProductsService } from '../../inventory/products.service';
import { StockMovementService } from '../../inventory/stock-movement.service';
import { CashShiftsService } from '../cash/cash-shifts.service';
import { CustomersService } from '../customers/customers.service';
import { PosCatalogService } from './pos-catalog.service';
import { PosCheckoutService } from './pos-checkout.service';
import { PosEquivalentsService } from './pos-equivalents.service';
import { PosPaymentService } from './pos-payment.service';
import { PosCardPaymentService } from './pos-card-payment.service';
import { PosQrPaymentService } from './pos-qr-payment.service';
import { MockPaymentProvider } from '../payments/mock-payment.provider';
import type { PaymentProviderRegistry } from '../payments/payment-provider';
import { SaleCancellationService } from '../sales/sale-cancellation.service';
import { SaleReceiptService } from '../sales/sale-receipt.service';
import { SaleVisibilityService } from '../sales/sale-visibility.service';
import { SalesHistoryService } from '../sales/sales-history.service';
import { PosProductSheetService } from './pos-product-sheet.service';
import { SalesOrderDispatchService } from '../orders/sales-order-dispatch.service';
import { SalesOrdersService } from '../orders/sales-orders.service';
import { QuoteLifecycleService } from '../quotes/quote-lifecycle.service';
import { QuotesService } from '../quotes/quotes.service';
import { StockReservationService } from '../../inventory/stock-reservation.service';

export interface Caller {
  userId: string;
  membershipId: string;
}

export function createPosFixture(prefix: string) {
  const run = randomUUID().slice(0, 8);
  let current: string | null = null;
  class TestPrisma extends PrismaClient {
    readonly tenant = this.$extends(tenantExtension(() => current));
  }
  const base = new TestPrisma();
  const prisma = base as unknown as PrismaService;
  const settings = new SettingsService(prisma);
  /** One mock adapter for the whole run, like the module: its in-memory state outlives a request. */
  const mock = new MockPaymentProvider();
  const providers: PaymentProviderRegistry = { QR: mock, CARD: mock };
  /** Extra permissions per membership id (the sales history reads `sales.history.view-all`). */
  const extraPermissions = new Map<string, string[]>();
  const membership = {
    permissions: async (id: string) => new Set(['sales.pos.use', ...(extraPermissions.get(id) ?? [])]),
    operableBranchIds: async () => null,
  } as never;

  const state = {
    run,
    base,
    companyId: '',
    otherCompanyId: '',
    branchId: '',
    otherBranchId: '',
    /** warehouse of the register */
    centralId: '',
    /** same branch, not the register's */
    annexId: '',
    otherCentralId: '',
    brandId: '',
    otherBrandId: '',
    bearingsId: '',
    sealsId: '',
    subcategoryId: '',
    otherCategoryId: '',
    cashier: { userId: '', membershipId: '' } as Caller,
    second: { userId: '', membershipId: '' } as Caller,
    noShift: { userId: '', membershipId: '' } as Caller,
    other: { userId: '', membershipId: '' } as Caller,
  };
  const userIds: string[] = [];
  let seq = 0;

  function useCompany(id: string) {
    current = id;
  }

  /** Services as one caller sees them. */
  function as(caller: Caller, opts: { operableBranchIds?: string[] } = {}) {
    const cls = {
      get: (k: string) => (k === 'companyId' ? current : k === 'membershipId' ? caller.membershipId : k === 'userId' ? caller.userId : null),
    } as never;
    const shifts = new CashShiftsService(prisma, cls, new AuditService(prisma, cls), new OutboxService(prisma, cls), membership);
    const audit = new AuditService(prisma, cls);
    const customers = new CustomersService(prisma, cls, audit);
    const outbox = new OutboxService(prisma, cls);
    const scopedMembership = opts.operableBranchIds ? ({ ...(membership as object), operableBranchIds: async () => opts.operableBranchIds } as never) : membership;
    const visibility = new SaleVisibilityService(cls, membership);
    const cancellations = new SaleCancellationService(prisma, cls, settings, audit, outbox, visibility, membership, new StockMovementService(cls, settings));
    const checkout = new PosCheckoutService(prisma, cls, shifts, settings, customers);
    const payment = new PosPaymentService(prisma, cls, shifts, settings, audit, outbox, new StockMovementService(cls, settings), checkout, providers);
    const reservations = new StockReservationService(cls, settings);
    const quotes = new QuotesService(prisma, cls, settings, audit, membership, customers);
    const orders = new SalesOrdersService(prisma, cls, audit, outbox, scopedMembership, reservations, settings);
    return {
      customers,
      quotes,
      quoteLifecycle: new QuoteLifecycleService(prisma, cls, settings, audit, outbox, quotes),
      orders,
      dispatches: new SalesOrderDispatchService(prisma, cls, audit, outbox, settings, scopedMembership, reservations, new StockMovementService(cls, settings), orders),
      catalog: new PosCatalogService(prisma, shifts, settings),
      checkout,
      payment,
      qr: new PosQrPaymentService(prisma, cls, shifts, settings, audit, payment, providers),
      card: new PosCardPaymentService(prisma, cls, shifts, settings, audit, payment, providers),
      receipts: new SaleReceiptService(prisma, cls, settings, outbox, audit, visibility),
      cancellations,
      history: new SalesHistoryService(prisma, visibility, settings, cancellations),
      equivalents: new PosEquivalentsService(prisma, shifts, new EquivalencesService(prisma, cls, audit, settings)),
      sheet: new PosProductSheetService(
        prisma,
        shifts,
        settings,
        new ProductsService(prisma, cls),
        new EquivalencesService(prisma, cls, audit, settings),
      ),
    };
  }

  async function newMember(label: string, companyId: string): Promise<Caller> {
    const user = await base.user.create({ data: { email: `${prefix}-${label}-${run}@example.com`, name: `User ${label}` } });
    userIds.push(user.id);
    const role = await base.role.create({ data: { companyId, key: `${label}-${run}`, name: 'Cajero' } });
    const m = await base.membership.create({ data: { companyId, userId: user.id, roleId: role.id, allBranches: true } });
    return { userId: user.id, membershipId: m.id };
  }

  async function openShift(caller: Caller, companyId: string, branchId: string, warehouseId: string) {
    seq += 1;
    const pos = await base.siatPointOfSale.create({ data: { companyId, branchId, code: 100 + seq, name: `POS ${seq}` } });
    const register = await base.cashRegister.create({
      data: { companyId, branchId, pointOfSaleId: pos.id, warehouseId, name: `Caja ${seq}` },
    });
    await base.cashShift.create({ data: { companyId, registerId: register.id, openingFloat: '100.00', openedById: caller.userId } });
  }

  interface ProductOptions {
    code?: string;
    name?: string;
    brandId?: string;
    categoryId?: string;
    price?: string;
    status?: 'ACTIVE' | 'INACTIVE' | 'DRAFT';
    companyId?: string;
    /** stock per warehouse, loaded through StockMovementService */
    stock?: Record<string, number>;
    reserved?: Record<string, number>;
    minStock?: Record<string, number>;
    dimensions?: { innerDiameter: string; outerDiameter: string; width: string };
    photos?: string[];
    sectors?: string[];
    /** technical specifications (seal, cage…), compared by the equivalences */
    attributes?: Record<string, unknown>;
  }

  async function newProduct(opts: ProductOptions = {}) {
    seq += 1;
    const companyId = opts.companyId ?? state.companyId;
    const product = await base.product.create({
      data: {
        companyId,
        sku: `${prefix}-${run}-${seq}`,
        manufacturerCode: opts.code ?? `${prefix.toUpperCase()}${run}-${seq}`,
        brandId: opts.brandId ?? state.brandId,
        categoryId: opts.categoryId ?? state.bearingsId,
        name: opts.name ?? 'Rodamiento rígido de bolas',
        salePrice: opts.price ?? '245.00',
        cost: '100.0000',
        status: opts.status ?? 'ACTIVE',
        ...(opts.photos ? { photos: opts.photos } : {}),
        ...(opts.sectors ? { sectors: opts.sectors } : {}),
        ...(opts.attributes ? { attributes: opts.attributes as object } : {}),
        ...(opts.dimensions ? { dimensions: { create: { companyId, ...opts.dimensions } } } : {}),
      },
    });
    const previous = current;
    current = companyId;
    try {
      const cls = { get: (k: string) => (k === 'companyId' ? companyId : null) } as never;
      const stock = new StockMovementService(cls, settings);
      for (const [warehouseId, quantity] of Object.entries(opts.stock ?? {})) {
        await prisma.tenant.$transaction((tx) =>
          stock.apply(tx, { productId: product.id, warehouseId, type: 'INITIAL', quantity, reason: 'Initial load' }),
        );
      }
    } finally {
      current = previous;
    }
    // a shortcut for the stock tests; the real path (quote -> order) is covered by sales-orders.int.spec.ts
    for (const [warehouseId, reserved] of Object.entries(opts.reserved ?? {})) {
      await base.stockLevel.update({ where: { productId_warehouseId: { productId: product.id, warehouseId } }, data: { reserved } });
    }
    for (const [warehouseId, minStock] of Object.entries(opts.minStock ?? {})) {
      await base.stockThreshold.create({ data: { companyId, productId: product.id, warehouseId, minStock } });
    }
    return product;
  }

  async function setAllowNegativeStock(value: boolean) {
    await base.companySetting.upsert({
      where: { companyId_key: { companyId: state.companyId, key: 'inventory.allowNegativeStock' } },
      create: { companyId: state.companyId, key: 'inventory.allowNegativeStock', value },
      update: { value },
    });
  }

  /** Links two products as equivalents (stored once, in canonical order). Approved unless `approved: false`. */
  async function link(idA: string, idB: string, opts: { notes?: string; substitute?: boolean; approved?: boolean } = {}) {
    const [productAId, productBId] = normalizePair(idA, idB);
    await base.equivalence.create({
      data: {
        companyId: state.companyId,
        productAId,
        productBId,
        notes: opts.notes ?? null,
        substitute: opts.substitute ?? false,
        approvedAt: opts.approved === false ? null : new Date(),
      },
    });
  }

  async function setRequireApproval(value: boolean) {
    await base.companySetting.upsert({
      where: { companyId_key: { companyId: state.companyId, key: 'inventory.equivalences.requireApproval' } },
      create: { companyId: state.companyId, key: 'inventory.equivalences.requireApproval', value },
      update: { value },
    });
  }

  /** Another branch of the company with one warehouse; returns the warehouse id. */
  async function newBranch(name: string, opts: { status?: 'ACTIVE' | 'INACTIVE'; warehouseStatus?: 'ACTIVE' | 'INACTIVE' } = {}) {
    seq += 1;
    const branch = await base.branch.create({ data: { companyId: state.companyId, code: 50 + seq, name, status: opts.status ?? 'ACTIVE' } });
    const warehouse = await base.warehouse.create({
      data: { companyId: state.companyId, branchId: branch.id, code: `B${seq}-${run}`, name: `Almacén ${name}`, status: opts.warehouseStatus ?? 'ACTIVE' },
    });
    return warehouse.id;
  }

  async function setup() {
    const company = await base.company.create({ data: { slug: `${prefix}-${run}`, legalName: prefix, tradeName: prefix, nit: `P${run}`.slice(0, 20) } });
    const otherCompany = await base.company.create({
      data: { slug: `${prefix}2-${run}`, legalName: `${prefix}2`, tradeName: `${prefix}2`, nit: `Q${run}`.slice(0, 20) },
    });
    state.companyId = company.id;
    state.otherCompanyId = otherCompany.id;
    current = company.id;
    state.branchId = (await base.branch.create({ data: { companyId: company.id, code: 0, name: 'Sucursal central' } })).id;
    state.otherBranchId = (await base.branch.create({ data: { companyId: otherCompany.id, code: 0, name: 'Other' } })).id;
    const wh = (companyId: string, branchId: string, code: string, name: string) =>
      base.warehouse.create({ data: { companyId, branchId, code: `${code}-${run}`, name } }).then((w) => w.id);
    state.centralId = await wh(company.id, state.branchId, 'C', 'Central');
    state.annexId = await wh(company.id, state.branchId, 'A', 'Anexo');
    state.otherCentralId = await wh(otherCompany.id, state.otherBranchId, 'O', 'Central');

    state.brandId = (await base.brand.create({ data: { companyId: company.id, name: `SKF${run}` } })).id;
    state.otherBrandId = (await base.brand.create({ data: { companyId: otherCompany.id, name: `SKF${run}` } })).id;
    state.bearingsId = (await base.category.create({ data: { companyId: company.id, name: 'Rodamientos', icon: 'bearing', sortOrder: 1 } })).id;
    state.sealsId = (await base.category.create({ data: { companyId: company.id, name: 'Retenes', icon: 'seal', sortOrder: 2 } })).id;
    state.subcategoryId = (await base.category.create({ data: { companyId: company.id, name: 'Rígidos', parentId: state.bearingsId } })).id;
    state.otherCategoryId = (await base.category.create({ data: { companyId: otherCompany.id, name: 'Otra' } })).id;

    state.cashier = await newMember('cashier', company.id);
    state.second = await newMember('second', company.id);
    state.noShift = await newMember('noshift', company.id);
    state.other = await newMember('other', otherCompany.id);
    await openShift(state.cashier, company.id, state.branchId, state.centralId);
    await openShift(state.second, company.id, state.branchId, state.centralId);
    await openShift(state.other, otherCompany.id, state.otherBranchId, state.otherCentralId);
  }

  async function teardown() {
    const companies = [state.companyId, state.otherCompanyId];
    await base.$transaction(async (tx) => {
      // the immutability trigger blocks DELETE on stock_movements; cleanup bypasses it inside its own transaction
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      await tx.stockMovement.deleteMany({ where: { companyId: { in: companies } } });
    });
    await base.dispatch.deleteMany({ where: { companyId: { in: companies } } });
    await base.salesOrder.deleteMany({ where: { companyId: { in: companies } } });
    await base.quote.deleteMany({ where: { companyId: { in: companies } } });
    await base.approvalRequest.deleteMany({ where: { companyId: { in: companies } } });
    await base.invoice.deleteMany({ where: { companyId: { in: companies } } });
    await base.sale.deleteMany({ where: { companyId: { in: companies } } });
    await base.cashMovement.deleteMany({ where: { companyId: { in: companies } } });
    await base.documentSequence.deleteMany({ where: { companyId: { in: companies } } });
    await base.posCheckoutItem.deleteMany({ where: { companyId: { in: companies } } });
    await base.posCheckout.deleteMany({ where: { companyId: { in: companies } } });
    await base.customer.deleteMany({ where: { companyId: { in: companies } } });
    await base.cashShift.deleteMany({ where: { companyId: { in: companies } } });
    await base.cashRegister.deleteMany({ where: { companyId: { in: companies } } });
    await base.siatPointOfSale.deleteMany({ where: { companyId: { in: companies } } });
    await base.stockThreshold.deleteMany({ where: { companyId: { in: companies } } });
    await base.stockLevel.deleteMany({ where: { companyId: { in: companies } } });
    await base.product.deleteMany({ where: { companyId: { in: companies } } });
    await base.companySetting.deleteMany({ where: { companyId: { in: companies } } });
    await base.outboxEvent.deleteMany({ where: { companyId: { in: companies } } });
    await base.auditLog.deleteMany({ where: { companyId: { in: companies } } });
    await base.membership.deleteMany({ where: { companyId: { in: companies } } });
    await base.user.deleteMany({ where: { id: { in: userIds } } });
    await base.role.deleteMany({ where: { companyId: { in: companies } } });
    await base.category.deleteMany({ where: { companyId: { in: companies }, parentId: { not: null } } });
    await base.category.deleteMany({ where: { companyId: { in: companies } } });
    await base.brand.deleteMany({ where: { companyId: { in: companies } } });
    await base.warehouse.deleteMany({ where: { companyId: { in: companies } } });
    await base.branch.deleteMany({ where: { companyId: { in: companies } } });
    await base.company.deleteMany({ where: { id: { in: companies } } });
    await base.$disconnect();
  }

  /** Gives a caller extra permissions (the fixture's callers only hold `sales.pos.use`). */
  function grant(caller: Caller, ...permissions: string[]) {
    extraPermissions.set(caller.membershipId, permissions);
  }

  /** A stock service for the current company, for tests that move stock outside the POS. */
  const stockService = () => new StockMovementService({ get: (k: string) => (k === 'companyId' ? current : null) } as never, settings);

  const settingsService = () => settings;
  /** Runs `fn` in a transaction of the current company, like `prisma.tenant.$transaction`. */
  const tenantTransaction = <T>(fn: (tx: never) => Promise<T>): Promise<T> => prisma.tenant.$transaction((tx) => fn(tx as never));

  return { state, settingsService, tenantTransaction, stockService, as, providers, mock, useCompany, newProduct, link, setRequireApproval, newBranch, setAllowNegativeStock, newMember, grant, setup, teardown };
}

/** The error code of a rejected call, or null when it succeeds. */
export async function codeOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    const known = err as { getResponse?: () => { code: string } };
    if (!known.getResponse) throw err;
    return known.getResponse().code;
  }
}

/** The `details` of a rejected call. */
export async function detailsOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return (err as { getResponse: () => { details?: unknown } }).getResponse().details;
  }
  return undefined;
}
