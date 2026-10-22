import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type {
  DuplicateProductResponse,
  ProductDetail,
  ProductFilterOptions,
  ProductListResponse,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../../common/cls';
import { MembershipService } from '../access/membership.service';
import { RequirePermissions } from '../access/require-permissions.decorator';
import { DuplicateProductDto, ListProductsQueryDto } from './dto';
import { ProductCommandsService } from './product-commands.service';
import { ProductsService } from './products.service';

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

  @Get('products/:id')
  @RequirePermissions('inventory.products.view')
  async detail(@Param('id', idPipe) id: string): Promise<ProductDetail> {
    const membershipId = this.cls.get('membershipId');
    const granted = membershipId ? await this.membership.permissions(membershipId) : new Set<string>();
    return this.products.detail(id, granted.has('inventory.costs.view'));
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
}
