import { BadRequestException, Controller, Get, Query, ValidationError, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { ProductFilterOptions, ProductListResponse } from '@rodasoft/domain';
import { RequirePermissions } from '../access/require-permissions.decorator';
import { ListProductsQueryDto } from './dto';
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

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

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
}
