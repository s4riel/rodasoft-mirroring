import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  buildDuplicate,
  type DuplicateProductResponse,
  type DuplicateSource,
  formatSku,
  parseSkuNumber,
  type ProductDraftInput,
  type ProductFieldError,
  SPEC_STEP_DIMENSIONS,
  validateProductDraft,
  type AttributeRule,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../common/audit/audit.service';
import type { AppClsStore } from '../../common/cls';
import { OutboxService } from '../../common/outbox/outbox.service';
import { PrismaService, type TenantTransaction } from '../../common/prisma/prisma.service';
import { SettingsService } from '../../common/settings/settings.service';
import { MembershipService } from '../access/membership.service';
import type { DuplicateProductDto } from './dto';
import { ProductWriteDto } from './product-write.dto';
import { StockMovementService } from './stock-movement.service';

const notFound = () => new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });

export interface ProductWriteResponse {
  id: string;
  sku: string;
  status: 'ACTIVE' | 'DRAFT';
}

export interface CodeAvailabilityResponse {
  available: boolean;
  productId: string | null;
}

/**
 * Write side of the catalog: the row actions of the list (HU-INV-02) and the creation wizard (HU-INV-06).
 * Stock changes only through `StockMovementService` (design-notes rule 1), so the initial stock of a new product is
 * recorded there as an INITIAL movement.
 *
 * Drafts keep the product fields only. The initial stock and the thresholds are applied when the product becomes
 * ACTIVE (on create or on finalize), so a draft never moves stock.
 */
@Injectable()
export class ProductCommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly audit: AuditService,
    private readonly membership: MembershipService,
    private readonly settings: SettingsService,
    private readonly stock: StockMovementService,
    private readonly outbox: OutboxService,
  ) {}

  /** Creates a product from the wizard: ACTIVE when `status` is ACTIVE (the default), a draft otherwise. */
  async create(dto: ProductWriteDto): Promise<ProductWriteResponse> {
    return this.write(null, dto);
  }

  /** Saves the wizard state of a draft. A PATCH sends the whole form, so missing fields are cleared. */
  async saveDraft(id: string, dto: ProductWriteDto): Promise<ProductWriteResponse> {
    return this.write(id, dto);
  }

  /** Live check of the (brand, code) pair. Drafts count, because the unique constraint covers them. */
  async codeAvailability(brandId: string, code: string): Promise<CodeAvailabilityResponse> {
    const existing = await this.prisma.tenant.product.findFirst({
      where: { brandId, manufacturerCode: code.trim() },
      select: { id: true },
    });
    return { available: !existing, productId: existing?.id ?? null };
  }

  async duplicate(id: string, dto: DuplicateProductDto): Promise<DuplicateProductResponse> {
    const companyId = this.companyId();
    const canCopyCost = await this.canViewCosts();
    // The tenant extension also applies inside the transaction; `companyId` is repeated on every query as defense
    // in depth (and because raw SQL and create payloads need it explicitly).
    try {
      return await this.prisma.tenant.$transaction(async (tx) => {
        const source = await tx.product.findFirst({ where: { id, companyId }, include: { dimensions: true } });
        if (!source) throw notFound();

        const brand = await tx.brand.findFirst({ where: { id: dto.brandId, companyId }, select: { id: true } });
        if (!brand) {
          throw new UnprocessableEntityException({ code: 'BRAND_NOT_FOUND', message: 'Brand not found' });
        }
        if (dto.countryId) {
          const country = await tx.country.findFirst({ where: { id: dto.countryId, companyId }, select: { id: true } });
          if (!country) {
            throw new UnprocessableEntityException({ code: 'COUNTRY_NOT_FOUND', message: 'Country not found' });
          }
        }

        const sku = await this.nextSku(tx, companyId);

        const { dimensions, ...payload } = buildDuplicate(toDuplicateSource(source, canCopyCost), dto);
        const created = await tx.product.create({
          data: {
            companyId,
            sku,
            manufacturerCode: payload.manufacturerCode,
            brandId: payload.brandId,
            countryId: payload.countryId,
            categoryId: payload.categoryId,
            name: payload.name,
            unit: payload.unit,
            status: payload.status,
            salePrice: payload.salePrice,
            cost: payload.cost,
            attributes: payload.attributes as Prisma.InputJsonObject,
            photos: payload.photos,
            datasheetUrl: payload.datasheetUrl,
            createdById: this.cls.get('userId'),
            updatedById: this.cls.get('userId'),
          },
          select: { id: true },
        });
        if (dimensions) {
          await tx.productDimension.create({
            data: { companyId, productId: created.id, ...dimensions },
          });
        }

        await this.audit.log(
          {
            action: 'inventory.product.duplicate',
            entity: 'Product',
            entityId: created.id,
            before: { sourceId: source.id },
            after: {
              sku,
              manufacturerCode: payload.manufacturerCode,
              brandId: payload.brandId,
              countryId: payload.countryId,
              copy: dto.copy,
            },
          },
          tx as unknown as Prisma.TransactionClient,
        );
        return { id: created.id, sku };
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          code: 'DUPLICATE_MANUFACTURER_CODE',
          message: 'A product with this manufacturer code already exists for the brand',
        });
      }
      throw err;
    }
  }

  async remove(id: string): Promise<void> {
    const companyId = this.companyId();
    await this.prisma.tenant.$transaction(async (tx) => {
      // the row lock keeps a concurrent stock write (movements service) from slipping in between check and delete
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM products WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;
      if (!locked.length) throw notFound();

      // any movement is history: the product is deactivated instead (design-notes rule 4, HU-INV-09)
      if ((await tx.stockMovement.count({ where: { productId: id, companyId } })) > 0) {
        throw new ConflictException({
          code: 'PRODUCT_HAS_MOVEMENTS',
          message: 'The product has stock movements and cannot be deleted; deactivate it instead',
        });
      }
      // reserved stock counts too: deleting its level would drop the reservation
      const withStock = { productId: id, companyId, OR: [{ quantity: { not: 0 } }, { reserved: { not: 0 } }] };
      if ((await tx.stockLevel.count({ where: withStock })) > 0) {
        throw new ConflictException({
          code: 'PRODUCT_HAS_STOCK',
          message: 'The product has stock and cannot be deleted; deactivate it instead',
        });
      }

      // zero levels and thresholds carry no history: they go with the product
      await this.stock.removeEmptyLevels(tx, id, companyId);
      await tx.stockThreshold.deleteMany({ where: { productId: id, companyId } });

      const before = await tx.product.findFirstOrThrow({ where: { id, companyId } });
      await tx.product.deleteMany({ where: { id, companyId } });
      await this.audit.log(
        {
          action: 'inventory.product.delete',
          entity: 'Product',
          entityId: id,
          before: {
            sku: before.sku,
            manufacturerCode: before.manufacturerCode,
            brandId: before.brandId,
            name: before.name,
          },
        },
        tx as unknown as Prisma.TransactionClient,
      );
    });
  }

  /**
   * Creates or saves a product from the wizard (HU-INV-06). One transaction: validation, references, the product,
   * its dimensions, and on activation the initial stock and thresholds, the audit entry and the outbox event.
   */
  private async write(id: string | null, request: ProductWriteDto): Promise<ProductWriteResponse> {
    const companyId = this.companyId();
    assertWizardShape(request);
    assertUploadKeys(companyId, request);
    const userId = this.cls.get('userId') ?? null;
    const canViewCosts = await this.canViewCosts();

    return this.prisma.tenant.$transaction(async (tx) => {
        // a draft save locks its row first, so two saves cannot merge from the same stored state and drop each other's fields
        if (id) await tx.$queryRaw`SELECT id FROM products WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;
        const stored = id ? await tx.product.findFirst({ where: { id, companyId }, include: { dimensions: true } }) : null;
        if (id && !stored) throw notFound();
        if (stored && stored.status !== 'DRAFT') {
          throw new ConflictException({ code: 'NOT_A_DRAFT', message: 'Only a draft can be saved from the wizard' });
        }
        const existing = stored ? { id: stored.id, sku: stored.sku } : null;
        // a save of a draft keeps every stored field the request leaves out
        const dto = stored ? mergeWithStored(request, stored) : request;

        const status: 'ACTIVE' | 'DRAFT' = dto.status ?? (existing ? 'DRAFT' : 'ACTIVE');
        const draft = status === 'DRAFT';
        // missing identity fields are empty strings here; the validation below refuses them before any lookup
        const code = dto.manufacturerCode?.trim() ?? '';
        const brandId = dto.brandId ?? '';
        const categoryId = dto.categoryId ?? '';
        const rules = categoryId ? await this.attributeRules(tx, categoryId) : [];
        const isBearing = rules.some((r) => r.step === SPEC_STEP_DIMENSIONS);

        const input: ProductDraftInput = {
          manufacturerCode: code || null,
          brandId: brandId || null,
          categoryId: categoryId || null,
          isBearing,
          salePrice: dto.salePrice ?? null,
          dimensions: { innerDiameter: dto.innerDiameter ?? null, outerDiameter: dto.outerDiameter ?? null, width: dto.width ?? null },
          attributes: dto.attributes ?? {},
        };
        // a draft may lack the rest, but not the category: the wizard picks it first and the row needs it
        const errors = validateProductDraft(input, rules, { draft });
        if (!categoryId) errors.push({ field: 'categoryId', code: 'CATEGORY_REQUIRED' });

        // references are checked before the field rules: an unknown category has no field rules to check against
        const brand = brandId ? await tx.brand.findFirst({ where: { id: brandId }, select: { id: true, name: true } }) : null;
        if (brandId && !brand) throw new UnprocessableEntityException({ code: 'BRAND_NOT_FOUND', message: 'Brand not found' });
        const category = categoryId ? await tx.category.findFirst({ where: { id: categoryId }, select: { id: true, name: true } }) : null;
        if (categoryId && !category) throw new UnprocessableEntityException({ code: 'CATEGORY_NOT_FOUND', message: 'Category not found' });
        assertValid(errors);
        // the empty-id cases were reported by assertValid above, so both rows are present here
        if (!brand || !category) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid request' });
        if (dto.countryId) {
          const country = await tx.country.findFirst({ where: { id: dto.countryId }, select: { id: true } });
          if (!country) throw new UnprocessableEntityException({ code: 'COUNTRY_NOT_FOUND', message: 'Country not found' });
        }

        // the stock side needs a receiving branch: its main warehouse holds the stock and the thresholds
        const wantsStock = !draft && ((dto.initialStock ?? 0) > 0 || [dto.minStock, dto.maxStock, dto.location].some((v) => v !== undefined));
        if (wantsStock && !dto.branchId) {
          throw new BadRequestException({
            code: 'VALIDATION_FAILED',
            message: 'Invalid request',
            details: [{ field: 'branchId', code: 'BRANCH_REQUIRED' }],
          });
        }
        const warehouseId = wantsStock && dto.branchId ? await this.receivingWarehouse(tx, dto.branchId) : null;

        const data = {
          manufacturerCode: code,
          brandId: brand.id,
          categoryId: category.id,
          countryId: dto.countryId ?? null,
          name: dto.name?.trim() || `${category.name} ${brand.name} ${code}`,
          unit: dto.unit ?? 'UN',
          salePrice: dto.salePrice ?? '0.00',
          status,
          sectors: dto.sectors ?? [],
          tariffCode: dto.tariffCode ?? null,
          supplierName: dto.supplierName ?? null,
          entryDate: dto.entryDate ? calendarDate(dto.entryDate) : null,
          attributes: (dto.attributes ?? {}) as Prisma.InputJsonObject,
          photos: dto.photos ?? [],
          datasheetUrl: dto.datasheetKey ?? null,
          updatedById: userId,
          ...(canViewCosts ? { cost: dto.cost ?? null } : {}),
        };

        let product: { id: string; sku: string };
        try {
          if (existing) {
            // conditional on DRAFT: when a concurrent save committed first, the row no longer matches and nothing is written
            const { count } = await tx.product.updateMany({ where: { id: existing.id, companyId, status: 'DRAFT' }, data });
            if (count !== 1) throw new ConflictException({ code: 'NOT_A_DRAFT', message: 'Only a draft can be saved from the wizard' });
            product = { id: existing.id, sku: existing.sku };
          } else {
            product = await tx.product.create({
              data: { ...data, companyId, sku: await this.nextSku(tx, companyId), createdById: userId },
              select: { id: true, sku: true },
            });
          }
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            throw new ConflictException({
              code: 'DUPLICATE_MANUFACTURER_CODE',
              message: 'A product with this manufacturer code already exists for the brand',
            });
          }
          throw err;
        }

        await this.saveDimensions(tx, companyId, product.id, dto);

        if (!draft) {
          if (warehouseId && (dto.initialStock ?? 0) > 0) {
            await this.stock.apply(tx, {
              productId: product.id,
              warehouseId,
              type: 'INITIAL',
              quantity: dto.initialStock ?? 0,
              reason: 'Initial stock on product creation',
              refType: 'PRODUCT',
              refId: product.id,
              refNumber: product.sku,
            });
          }
          if (warehouseId) await this.saveThreshold(tx, companyId, product.id, warehouseId, dto);
        }

        await this.audit.log(
          {
            action: existing ? (draft ? 'inventory.product.draft.save' : 'inventory.product.finalize') : draft ? 'inventory.product.draft.create' : 'inventory.product.create',
            entity: 'Product',
            entityId: product.id,
            after: { sku: product.sku, status, manufacturerCode: data.manufacturerCode, brandId: brand.id, categoryId: data.categoryId },
          },
          tx as unknown as Prisma.TransactionClient,
        );
        if (!draft) {
          await this.outbox.publish(
            'inventory.product-created',
            { productId: product.id, sku: product.sku },
            { tx, companyId, idempotencyKey: `inventory.product-created:${product.id}` },
          );
        }
        return { id: product.id, sku: product.sku, status };
      });
  }

  /** Attribute definitions of a category, falling back to its parent's when it has none (as the wizard shows them). */
  private async attributeRules(tx: TenantTransaction, categoryId: string): Promise<(AttributeRule & { step: number })[]> {
    const order = [{ step: 'asc' as const }, { sortOrder: 'asc' as const }];
    let defs = await tx.attributeDefinition.findMany({ where: { categoryId }, orderBy: order });
    if (!defs.length) {
      const category = await tx.category.findFirst({ where: { id: categoryId }, select: { parentId: true } });
      if (category?.parentId) defs = await tx.attributeDefinition.findMany({ where: { categoryId: category.parentId }, orderBy: order });
    }
    return defs.map((d) => ({
      key: d.key,
      type: d.type,
      required: d.required,
      options: Array.isArray(d.options) ? (d.options as string[]) : null,
      step: d.step,
    }));
  }

  /** The main warehouse of the branch, if the member may operate that branch. */
  private async receivingWarehouse(tx: TenantTransaction, branchId: string): Promise<string> {
    const membershipId = this.cls.get('membershipId');
    const allowed = membershipId ? await this.membership.operableBranchIds(membershipId) : [];
    if (allowed && !allowed.includes(branchId)) {
      throw new ForbiddenException({ code: 'BRANCH_NOT_ALLOWED', message: 'You cannot operate this branch' });
    }
    const warehouse = await tx.warehouse.findFirst({ where: { branchId, isMain: true, status: 'ACTIVE' }, select: { id: true } });
    if (!warehouse) throw new UnprocessableEntityException({ code: 'WAREHOUSE_NOT_FOUND', message: 'The branch has no main warehouse' });
    return warehouse.id;
  }

  private async saveDimensions(tx: TenantTransaction, companyId: string, productId: string, dto: ProductWriteDto) {
    // categories without a dimensions step (seals) keep d, D and B as technical fields: they fill the columns too
    const attributeMeasure = (key: string): string | null => {
      const value = dto.attributes?.[key];
      return typeof value === 'number' || typeof value === 'string' ? String(value) : null;
    };
    const values = {
      innerDiameter: dto.innerDiameter ?? attributeMeasure('innerDiameter'),
      outerDiameter: dto.outerDiameter ?? attributeMeasure('outerDiameter'),
      width: dto.width ?? attributeMeasure('width'),
      weight: dto.weight ?? null,
    };
    if (Object.values(values).every((v) => v === null)) {
      await tx.productDimension.deleteMany({ where: { productId } });
      return;
    }
    await tx.productDimension.upsert({
      where: { productId },
      create: { companyId, productId, ...values },
      update: values,
    });
  }

  private async saveThreshold(tx: TenantTransaction, companyId: string, productId: string, warehouseId: string, dto: ProductWriteDto) {
    if (dto.minStock === undefined && dto.maxStock === undefined && dto.location === undefined) return;
    const values = { minStock: dto.minStock ?? null, maxStock: dto.maxStock ?? null, location: dto.location ?? null };
    await tx.stockThreshold.upsert({
      where: { productId_warehouseId: { productId, warehouseId } },
      create: { companyId, productId, warehouseId, ...values },
      update: values,
    });
  }

  /**
   * Next internal SKU of the company, with the prefix from its settings (decision #32). The advisory lock serializes
   * generation per company until the transaction ends; only numeric SKUs with the prefix count.
   */
  private async nextSku(tx: TenantTransaction, companyId: string): Promise<string> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId}::text || ':sku'))`;
    const prefix = await this.settings.get('inventory.skuPrefix', tx);
    const pattern = `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[0-9]{6,}$`;
    const last = await tx.$queryRaw<{ sku: string }[]>`
      SELECT sku FROM products
      WHERE company_id = ${companyId}::uuid AND sku ~ ${pattern}
      ORDER BY length(sku) DESC, sku DESC LIMIT 1`;
    return formatSku(prefix, (last[0] ? (parseSkuNumber(last[0].sku, prefix) ?? 0) : 0) + 1);
  }

  /** Cost is only visible with `inventory.costs.view`, so a copy by anyone else must not inherit it. */
  private async canViewCosts(): Promise<boolean> {
    const membershipId = this.cls.get('membershipId');
    if (!membershipId) return false;
    return (await this.membership.permissions(membershipId)).has('inventory.costs.view');
  }

  private companyId(): string {
    const companyId = this.cls.get('companyId');
    if (!companyId) throw new Error('Missing company in context');
    return companyId;
  }
}

/** Blocking errors are 400 with their fields; a missing price is its own 422, which the wizard shows on the price step. */
function assertValid(errors: ProductFieldError[]): void {
  if (!errors.length) return;
  const blocking = errors.filter((e) => e.code !== 'PRICE_REQUIRED');
  if (blocking.length) {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Invalid request',
      details: blocking.map((e) => ({ field: e.field, code: e.code })),
    });
  }
  throw new UnprocessableEntityException({ code: 'PRICE_REQUIRED', message: 'The product needs a sale price' });
}

/** Rejects the shapes the DTO cannot check: a date that does not exist, and a minimum above the maximum. */
function assertWizardShape(dto: ProductWriteDto): void {
  const details: { field: string; code: string }[] = [];
  if (dto.entryDate && !calendarDate(dto.entryDate)) details.push({ field: 'entryDate', code: 'INVALID_DATE' });
  if (dto.minStock !== undefined && dto.maxStock !== undefined && dto.minStock > dto.maxStock) {
    details.push({ field: 'maxStock', code: 'MAX_BELOW_MIN' });
  }
  if (details.length) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid request', details });
}

/** A calendar date as `YYYY-MM-DD`, or null when it does not exist (for example 2026-02-30). */
function calendarDate(value: string): Date | null {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function toDuplicateSource(
  p: Prisma.ProductGetPayload<{ include: { dimensions: true } }>,
  includeCost: boolean,
): DuplicateSource {
  const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  return {
    name: p.name,
    categoryId: p.categoryId,
    unit: p.unit,
    salePrice: p.salePrice.toFixed(2),
    cost: includeCost && p.cost ? p.cost.toFixed(4) : null,
    attributes: isRecord(p.attributes) ? p.attributes : {},
    photos: Array.isArray(p.photos) ? (p.photos as string[]) : [],
    datasheetUrl: p.datasheetUrl,
    dimensions: p.dimensions
      ? {
          innerDiameter: p.dimensions.innerDiameter?.toString() ?? null,
          outerDiameter: p.dimensions.outerDiameter?.toString() ?? null,
          width: p.dimensions.width?.toString() ?? null,
          weight: p.dimensions.weight?.toString() ?? null,
        }
      : null,
  };
}

/**
 * Files come from `POST /inventory/uploads`, whose keys are `<company>/<kind>/<uuid>.<ext>`. A key that does not match
 * this company and kind is refused, so a product cannot point at another company's file.
 */
function assertUploadKeys(companyId: string, dto: ProductWriteDto): void {
  const photo = new RegExp(`^${companyId}/photo/[0-9a-f-]{36}\\.(jpg|png|webp)$`);
  const datasheet = new RegExp(`^${companyId}/datasheet/[0-9a-f-]{36}\\.pdf$`);
  const details: { field: string; code: string }[] = [];
  for (const key of dto.photos ?? []) if (!photo.test(key)) details.push({ field: 'photos', code: 'INVALID_FILE_KEY' });
  if (dto.datasheetKey && !datasheet.test(dto.datasheetKey)) details.push({ field: 'datasheetKey', code: 'INVALID_FILE_KEY' });
  if (details.length) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid request', details });
}

/**
 * Fills the fields a draft save leaves out with the stored values (PATCH semantics, HU-INV-06). A field sent as `null` is
 * cleared; a field that is absent keeps what is stored. Required fields (code, brand, category, unit) cannot be cleared.
 */
function mergeWithStored(request: ProductWriteDto, stored: Prisma.ProductGetPayload<{ include: { dimensions: true } }>): ProductWriteDto {
  const keep = <T>(sent: T | null | undefined, storedValue: T | undefined): T | undefined =>
    sent === undefined ? storedValue : (sent ?? undefined);
  const storedAttributes = stored.attributes && typeof stored.attributes === 'object' && !Array.isArray(stored.attributes) ? stored.attributes : {};
  return {
    ...request,
    manufacturerCode: request.manufacturerCode ?? stored.manufacturerCode,
    brandId: request.brandId ?? stored.brandId,
    categoryId: request.categoryId ?? stored.categoryId,
    unit: request.unit ?? stored.unit,
    countryId: keep(request.countryId, stored.countryId ?? undefined),
    name: keep(request.name, stored.name),
    salePrice: keep(request.salePrice, stored.salePrice.toFixed(2)),
    cost: keep(request.cost, stored.cost?.toFixed(4)),
    innerDiameter: keep(request.innerDiameter, stored.dimensions?.innerDiameter?.toString()),
    outerDiameter: keep(request.outerDiameter, stored.dimensions?.outerDiameter?.toString()),
    width: keep(request.width, stored.dimensions?.width?.toString()),
    weight: keep(request.weight, stored.dimensions?.weight?.toString()),
    attributes: { ...(storedAttributes as Record<string, unknown>), ...(request.attributes ?? {}) },
    photos: request.photos ?? (Array.isArray(stored.photos) ? (stored.photos as string[]) : []),
    datasheetKey: keep(request.datasheetKey, stored.datasheetUrl ?? undefined),
    sectors: request.sectors ?? stored.sectors,
    tariffCode: keep(request.tariffCode, stored.tariffCode ?? undefined),
    supplierName: keep(request.supplierName, stored.supplierName ?? undefined),
    entryDate: keep(request.entryDate, stored.entryDate ? stored.entryDate.toISOString().slice(0, 10) : undefined),
  };
}
