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
  diffProduct,
  type DuplicateProductResponse,
  type DuplicateSource,
  editableFields,
  formatSku,
  MOVEMENT_LOCKED_FIELDS,
  parseSkuNumber,
  PRODUCT_READONLY_FIELDS,
  type ProductChange,
  type ProductDraftInput,
  type ProductFieldError,
  type ProductSnapshot,
  type ProductUpdateResponse,
  SPEC_STEP_DIMENSIONS,
  todayInLaPaz,
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
import { ProductUpdateDto, ProductWriteDto } from './product-write.dto';
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

  /**
   * Live check of the (brand, code) pair. Drafts count, because the unique constraint covers them. The comparison ignores
   * the case ("6205-2rs" is "6205-2RS"): the unique index is exact, so the application is the one that refuses the pair.
   */
  async codeAvailability(brandId: string, code: string, excludeId?: string): Promise<CodeAvailabilityResponse> {
    const existing = await this.prisma.tenant.product.findFirst({
      where: { brandId, manufacturerCode: { equals: code.trim(), mode: 'insensitive' }, ...(excludeId ? { id: { not: excludeId } } : {}) },
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
          cost: dto.cost ?? null,
          weight: dto.weight ?? null,
          tariffCode: dto.tariffCode ?? null,
          entryDate: dto.entryDate ?? null,
          minStock: dto.minStock ?? null,
          maxStock: dto.maxStock ?? null,
          today: todayInLaPaz(),
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

        // the same code under the same brand, in any case, belongs to another product: refuse before writing anything
        const taken = await this.codeAvailability(brand.id, code, existing?.id);
        if (!taken.available) {
          throw new ConflictException({
            code: 'DUPLICATE_MANUFACTURER_CODE',
            message: 'A product with this manufacturer code already exists for the brand',
            details: { productId: taken.productId },
          });
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

  /**
   * Edits a finished product (HU-INV-07). The body is the whole form: a field that is absent keeps its stored value, a
   * `null` clears it. One transaction: the row lock, the `expectedUpdatedAt` check, the editable-fields check, the same
   * validation as creation, the update, the audit entry (only what changed) and the outbox event. Stock is never written
   * here (design-notes rule 1): only the thresholds of one warehouse.
   */
  async update(id: string, request: ProductUpdateDto): Promise<ProductUpdateResponse> {
    const companyId = this.companyId();
    assertEditableShape(request);
    assertWizardShape(request);
    assertUploadKeys(companyId, request);
    const userId = this.cls.get('userId') ?? null;
    const canViewCosts = await this.canViewCosts();
    const expected = new Date(request.expectedUpdatedAt).getTime();
    const thresholdTouched = [request.minStock, request.maxStock, request.location].some((v) => v !== undefined);
    if (thresholdTouched && !request.thresholdBranchId) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Invalid request',
        details: [{ field: 'thresholdBranchId', code: 'BRANCH_REQUIRED' }],
      });
    }

    try {
      return await this.prisma.tenant.$transaction(async (tx) => {
        // the lock serializes edits of the same product: the second one reads the first one's `updated_at` and is refused
        await tx.$queryRaw`SELECT id FROM products WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;
        const stored = await tx.product.findFirst({ where: { id, companyId }, include: { dimensions: true } });
        if (!stored) throw notFound();
        if (stored.status === 'DRAFT') {
          throw new ConflictException({ code: 'NOT_EDITABLE_DRAFT', message: 'A draft is edited from the creation wizard' });
        }
        if (stored.updatedAt.getTime() !== expected) {
          throw new ConflictException({
            code: 'PRODUCT_MODIFIED',
            message: 'The product was modified by someone else',
            details: { updatedAt: stored.updatedAt.toISOString() },
          });
        }

        const hasMovements = (await tx.stockMovement.count({ where: { productId: id, companyId } })) > 0;
        const editable = editableFields({ hasMovements, canViewCost: canViewCosts });
        const categoryChanged = request.categoryId !== undefined && request.categoryId !== stored.categoryId;
        const brandChanged = request.brandId !== undefined && request.brandId !== stored.brandId;
        if ((categoryChanged && !editable.categoryId) || (brandChanged && !editable.brandId)) {
          throw new ConflictException({
            code: 'PRODUCT_HAS_MOVEMENTS',
            message: 'The brand and the category cannot change once the product has stock movements',
            details: MOVEMENT_LOCKED_FIELDS,
          });
        }

        // the technical fields belong to the category: a new category starts from the ones the form sent
        const merged = mergeWithStored(request, stored);
        const dto: ProductWriteDto = categoryChanged ? { ...merged, attributes: request.attributes ?? {} } : merged;
        // an empty technical field is no value: it is not stored
        const attributes = Object.fromEntries(Object.entries(dto.attributes ?? {}).filter(([, v]) => v !== null && v !== ''));

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
          attributes,
          cost: canViewCosts ? (dto.cost ?? null) : null,
          weight: dto.weight ?? null,
          tariffCode: dto.tariffCode ?? null,
          entryDate: dto.entryDate ?? null,
          minStock: request.minStock ?? null,
          maxStock: request.maxStock ?? null,
          today: todayInLaPaz(),
        };
        const errors = validateProductDraft(input, rules, { draft: false });

        // references are checked before the field rules, as in creation
        const brand = brandId ? await tx.brand.findFirst({ where: { id: brandId }, select: { id: true, name: true } }) : null;
        if (brandId && !brand) throw new UnprocessableEntityException({ code: 'BRAND_NOT_FOUND', message: 'Brand not found' });
        const category = categoryId ? await tx.category.findFirst({ where: { id: categoryId }, select: { id: true, name: true } }) : null;
        if (categoryId && !category) throw new UnprocessableEntityException({ code: 'CATEGORY_NOT_FOUND', message: 'Category not found' });
        assertValid(errors);
        if (!brand || !category) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid request' });
        if (dto.countryId) {
          const country = await tx.country.findFirst({ where: { id: dto.countryId }, select: { id: true } });
          if (!country) throw new UnprocessableEntityException({ code: 'COUNTRY_NOT_FOUND', message: 'Country not found' });
        }
        const taken = await this.codeAvailability(brand.id, code, id);
        if (!taken.available) {
          throw new ConflictException({
            code: 'DUPLICATE_MANUFACTURER_CODE',
            message: 'A product with this manufacturer code already exists for the brand',
            details: { productId: taken.productId },
          });
        }

        const before = snapshotOf(stored);
        const measures = measuresOf({ ...dto, attributes });
        const after: ProductSnapshot = {
          manufacturerCode: code,
          name: dto.name?.trim() || `${category.name} ${brand.name} ${code}`,
          brandId: brand.id,
          categoryId: category.id,
          countryId: dto.countryId ?? null,
          unit: dto.unit ?? 'UN',
          salePrice: dto.salePrice ?? null,
          cost: canViewCosts ? (dto.cost ?? null) : before.cost,
          ...measures,
          attributes,
          sectors: dto.sectors ?? [],
          tariffCode: dto.tariffCode ?? null,
          supplierName: dto.supplierName ?? null,
          entryDate: dto.entryDate ?? null,
          photos: dto.photos ?? [],
          datasheetKey: dto.datasheetKey ?? null,
        };
        const change = diffProduct(before, after);

        const warehouseId = thresholdTouched && request.thresholdBranchId ? await this.receivingWarehouse(tx, request.thresholdBranchId) : null;
        const thresholdChange = warehouseId ? await this.thresholdChange(tx, id, warehouseId, request) : null;
        if (!Object.keys(change.after).length && !thresholdChange) {
          return { id, sku: stored.sku, updatedAt: stored.updatedAt.toISOString() };
        }
        const audited: ProductChange = {
          before: { ...change.before, ...thresholdChange?.before },
          after: { ...change.after, ...thresholdChange?.after },
        };

        // `updated_at` moves with every save: it is what the next editor's lock compares against
        await tx.product.updateMany({
          where: { id, companyId },
          data: {
            manufacturerCode: after.manufacturerCode,
            brandId: after.brandId,
            categoryId: after.categoryId,
            countryId: after.countryId,
            name: after.name,
            unit: after.unit,
            salePrice: after.salePrice ?? '0.00',
            sectors: [...after.sectors],
            tariffCode: after.tariffCode,
            supplierName: after.supplierName,
            entryDate: after.entryDate ? calendarDate(after.entryDate) : null,
            attributes: attributes as Prisma.InputJsonObject,
            photos: [...after.photos],
            datasheetUrl: after.datasheetKey,
            updatedById: userId,
            ...(canViewCosts ? { cost: after.cost } : {}),
          },
        });
        await this.saveDimensions(tx, companyId, id, { ...dto, attributes });
        if (warehouseId && thresholdChange) await this.saveThreshold(tx, companyId, id, warehouseId, thresholdChange.values);

        await this.audit.log(
          { action: 'inventory.product.update', entity: 'Product', entityId: id, before: audited.before, after: audited.after },
          tx as unknown as Prisma.TransactionClient,
        );
        const saved = await tx.product.findFirstOrThrow({ where: { id, companyId }, select: { updatedAt: true } });
        await this.outbox.publish(
          'inventory.product-updated',
          { productId: id, sku: stored.sku, fields: Object.keys(audited.after) },
          { tx, companyId, idempotencyKey: `inventory.product-updated:${id}:${saved.updatedAt.getTime()}` },
        );
        return { id, sku: stored.sku, updatedAt: saved.updatedAt.toISOString() };
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

  /** The thresholds of the warehouse as the edit leaves them and what differs from the stored row; null when nothing does. */
  private async thresholdChange(tx: TenantTransaction, productId: string, warehouseId: string, request: ProductUpdateDto) {
    const stored = await tx.stockThreshold.findUnique({ where: { productId_warehouseId: { productId, warehouseId } } });
    const was = { minStock: stored?.minStock ?? null, maxStock: stored?.maxStock ?? null, location: stored?.location ?? null };
    const values = {
      minStock: request.minStock === undefined ? was.minStock : request.minStock,
      maxStock: request.maxStock === undefined ? was.maxStock : request.maxStock,
      location: request.location === undefined ? was.location : request.location,
    };
    // a minimum above the maximum is refused whichever of the two the request sent
    if (values.minStock !== null && values.maxStock !== null && values.minStock > values.maxStock) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Invalid request',
        details: [{ field: 'maxStock', code: 'MAX_BELOW_MIN' }],
      });
    }
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const field of ['minStock', 'maxStock', 'location'] as const) {
      if (values[field] !== was[field]) {
        before[field] = was[field];
        after[field] = values[field];
      }
    }
    return Object.keys(after).length ? { before, after, values } : null;
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
    const values = measuresOf(dto);
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

  private async saveThreshold(
    tx: TenantTransaction,
    companyId: string,
    productId: string,
    warehouseId: string,
    dto: { minStock?: number | null; maxStock?: number | null; location?: string | null },
  ) {
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

/** An edit cannot change stock, the receiving branch or the status: asking for it is a 400, not a silent skip. */
function assertEditableShape(dto: ProductUpdateDto): void {
  const sent = PRODUCT_READONLY_FIELDS.filter((field) => (dto as unknown as Record<string, unknown>)[field] !== undefined);
  if (!sent.length) return;
  throw new BadRequestException({
    code: 'FIELD_NOT_EDITABLE',
    message: 'These fields cannot be edited here',
    details: sent.map((field) => ({ field, code: 'FIELD_NOT_EDITABLE' })),
  });
}

/** d, D, B and weight as stored. Categories without a dimensions step (seals) keep them as technical fields: they fill the columns too. */
function measuresOf(dto: Pick<ProductWriteDto, 'attributes' | 'innerDiameter' | 'outerDiameter' | 'width' | 'weight'>) {
  const attributeMeasure = (key: string): string | null => {
    const value = dto.attributes?.[key];
    return typeof value === 'number' || typeof value === 'string' ? String(value) : null;
  };
  return {
    innerDiameter: dto.innerDiameter ?? attributeMeasure('innerDiameter'),
    outerDiameter: dto.outerDiameter ?? attributeMeasure('outerDiameter'),
    width: dto.width ?? attributeMeasure('width'),
    weight: dto.weight ?? null,
  };
}

/** The stored product as the edit form sees it, to compare with what the form sends back. */
function snapshotOf(p: Prisma.ProductGetPayload<{ include: { dimensions: true } }>): ProductSnapshot {
  return {
    manufacturerCode: p.manufacturerCode,
    name: p.name,
    brandId: p.brandId,
    categoryId: p.categoryId,
    countryId: p.countryId,
    unit: p.unit,
    salePrice: p.salePrice.toFixed(2),
    cost: p.cost ? p.cost.toFixed(4) : null,
    innerDiameter: p.dimensions?.innerDiameter?.toString() ?? null,
    outerDiameter: p.dimensions?.outerDiameter?.toString() ?? null,
    width: p.dimensions?.width?.toString() ?? null,
    weight: p.dimensions?.weight?.toString() ?? null,
    attributes: p.attributes && typeof p.attributes === 'object' && !Array.isArray(p.attributes) ? (p.attributes as Record<string, unknown>) : {},
    sectors: p.sectors,
    tariffCode: p.tariffCode,
    supplierName: p.supplierName,
    entryDate: p.entryDate ? p.entryDate.toISOString().slice(0, 10) : null,
    photos: Array.isArray(p.photos) ? (p.photos as string[]) : [],
    datasheetKey: p.datasheetUrl,
  };
}

/** Rejects the shapes the DTO cannot check: a date that does not exist, and a minimum above the maximum. */
function assertWizardShape(dto: ProductWriteDto): void {
  const details: { field: string; code: string }[] = [];
  if (dto.entryDate && !calendarDate(dto.entryDate)) details.push({ field: 'entryDate', code: 'INVALID_DATE' });
  if (typeof dto.minStock === 'number' && typeof dto.maxStock === 'number' && dto.minStock > dto.maxStock) {
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
 * Files come from `POST /inventory/uploads`, which answers a key `<company>/<kind>/<code>_v<n>.<ext>` on disk, or the Cloudinary
 * URL of that path. A reference that does not match this company and kind is refused, so a product cannot point at another
 * company's file.
 */
function assertUploadKeys(companyId: string, dto: ProductWriteDto): void {
  const reference = (kind: string, ext: string) =>
    new RegExp(`^(https://res\\.cloudinary\\.com/[\\w-]+/(image|raw)/upload/(v\\d+/)?([\\w-]+/)*)?${companyId}/${kind}/[A-Za-z0-9-]+_v\\d+\\.(${ext})$`);
  const photo = reference('photo', 'jpg|png|webp');
  const datasheet = reference('datasheet', 'pdf');
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
