import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  buildDuplicate,
  type DuplicateProductResponse,
  type DuplicateSource,
  formatSku,
  parseSkuNumber,
  SKU_PREFIX,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../common/audit/audit.service';
import type { AppClsStore } from '../../common/cls';
import { MembershipService } from '../access/membership.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { DuplicateProductDto } from './dto';

const notFound = () => new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });

/**
 * Write side of the catalog for the row actions of the list (HU-INV-02). It never touches `stock_levels`:
 * stock changes only through the movements service (HU-INV-16).
 * No outbox event: nothing consumes product events yet.
 */
@Injectable()
export class ProductCommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly audit: AuditService,
    private readonly membership: MembershipService,
  ) {}

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

        // serializes SKU generation per company; released when the transaction ends
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId}::text || ':sku'))`;
        const last = await tx.$queryRaw<{ sku: string }[]>`
          SELECT sku FROM products
          WHERE company_id = ${companyId}::uuid AND sku ~ '^RL-[0-9]{6,}$'
          ORDER BY length(sku) DESC, sku DESC LIMIT 1`;
        const sku = formatSku(SKU_PREFIX, (last[0] ? (parseSkuNumber(last[0].sku, SKU_PREFIX) ?? 0) : 0) + 1);

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
      await tx.stockLevel.deleteMany({ where: { productId: id, companyId } });
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
