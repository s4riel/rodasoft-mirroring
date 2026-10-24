import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  ParseUUIDPipe,
  Post,
  Query,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type {
  CategoryAttributeDefinitionsResponse,
  DuplicateProductResponse,
  ProductDetail,
  ProductEditModel,
  ProductFilterOptions,
  ProductListResponse,
  ProductMovementsResponse,
  ProductUpdateResponse,
  ProductWarehouseStockResponse,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../../common/cls';
import { MembershipService } from '../access/membership.service';
import { RequirePermissions } from '../access/require-permissions.decorator';
import { DuplicateProductDto, ListMovementsQueryDto, ListProductsQueryDto } from './dto';
import { CodeAvailabilityQueryDto, ProductUpdateDto, ProductWriteDto } from './product-write.dto';
import { type CodeAvailabilityResponse, ProductCommandsService, type ProductWriteResponse } from './product-commands.service';
import { ProductsService } from './products.service';
import { StockQueriesService } from './stock-queries.service';

const filterPipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: (errors: ValidationError[]) =>
    new BadRequestException({
      code: 'INVALID_FILTER',
      message: 'Invalid filter',
      details: errors.map((e) => ({ field: e.property, constraints: e.constraints })),
    }),
});

const bodyPipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: (errors: ValidationError[]) =>
    new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Invalid request',
      details: errors.map((e) => ({ field: e.property, constraints: e.constraints })),
    }),
});

const idPipe = new ParseUUIDPipe({
  exceptionFactory: () => new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid id' }),
});

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory')
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly commands: ProductCommandsService,
    private readonly stock: StockQueriesService,
    private readonly membership: MembershipService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  @Get('products')
  @RequirePermissions('inventory.products.view')
  list(@Query(filterPipe) query: ListProductsQueryDto): Promise<ProductListResponse> {
    return this.products.list(query);
  }

  @Get('filter-options')
  @RequirePermissions('inventory.products.view')
  filterOptions(): Promise<ProductFilterOptions> {
    return this.products.filterOptions();
  }

  /** Declared before `products/:id`, so the path is not read as an id. */
  @Get('products/code-availability')
  @RequirePermissions('inventory.products.edit')
  codeAvailability(@Query(filterPipe) query: CodeAvailabilityQueryDto): Promise<CodeAvailabilityResponse> {
    return this.commands.codeAvailability(query.brandId, query.code);
  }

  @Get('categories/:id/attribute-definitions')
  @RequirePermissions('inventory.products.view')
  attributeDefinitions(@Param('id', idPipe) id: string): Promise<CategoryAttributeDefinitionsResponse> {
    return this.products.attributeDefinitions(id);
  }

  @Post('products')
  @RequirePermissions('inventory.products.edit')
  create(@Body(bodyPipe) body: ProductWriteDto): Promise<ProductWriteResponse> {
    return this.commands.create(body);
  }

  @Patch('products/:id/draft')
  @RequirePermissions('inventory.products.edit')
  saveDraft(@Param('id', idPipe) id: string, @Body(bodyPipe) body: ProductWriteDto): Promise<ProductWriteResponse> {
    return this.commands.saveDraft(id, body);
  }

  @Get('products/:id/edit-model')
  @RequirePermissions('inventory.products.edit')
  async editModel(@Param('id', idPipe) id: string): Promise<ProductEditModel> {
    return this.products.editModel(id, await this.canViewCosts());
  }

  @Patch('products/:id')
  @RequirePermissions('inventory.products.edit')
  update(@Param('id', idPipe) id: string, @Body(bodyPipe) body: ProductUpdateDto): Promise<ProductUpdateResponse> {
    return this.commands.update(id, body);
  }

  @Get('products/:id')
  @RequirePermissions('inventory.products.view')
  async detail(@Param('id', idPipe) id: string): Promise<ProductDetail> {
    return this.products.detail(id, await this.canViewCosts());
  }

  @Get('products/:id/movements')
  @RequirePermissions('inventory.products.view')
  movements(
    @Param('id', idPipe) id: string,
    @Query(filterPipe) query: ListMovementsQueryDto,
  ): Promise<ProductMovementsResponse> {
    return this.stock.movements(id, query);
  }

  @Get('products/:id/stock')
  @RequirePermissions('inventory.products.view')
  stockByWarehouse(@Param('id', idPipe) id: string): Promise<ProductWarehouseStockResponse> {
    return this.stock.stockByWarehouse(id);
  }

  @Post('products/:id/duplicate')
  @RequirePermissions('inventory.products.edit')
  duplicate(@Param('id', idPipe) id: string, @Body(bodyPipe) body: DuplicateProductDto): Promise<DuplicateProductResponse> {
    return this.commands.duplicate(id, body);
  }

  @Delete('products/:id')
  @HttpCode(204)
  @RequirePermissions('inventory.products.delete')
  remove(@Param('id', idPipe) id: string): Promise<void> {
    return this.commands.remove(id);
  }

  private async canViewCosts(): Promise<boolean> {
    const membershipId = this.cls.get('membershipId');
    const granted = membershipId ? await this.membership.permissions(membershipId) : new Set<string>();
    return granted.has('inventory.costs.view');
  }
}
