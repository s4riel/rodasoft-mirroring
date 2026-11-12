import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, ValidationError, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { BulkPricePreview, BulkPriceResult, PriceDetail, PriceListResponse } from '@rodasoft/domain';
import { RequirePermissions } from '../../access/require-permissions.decorator';
import { PriceBulkService } from './price-bulk.service';
import { BulkPriceApplyDto, BulkPriceDto, EditPriceDto, ListPricesQueryDto } from './prices.dto';
import { priceErrors } from './prices.errors';
import { PricesService } from './prices.service';

function strictValidationPipe(code: string, message: string): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    exceptionFactory: (errors: ValidationError[]) =>
      new BadRequestException({ code, message, details: errors.map((e) => ({ field: e.property, constraints: e.constraints })) }),
  });
}

const filterPipe = strictValidationPipe('INVALID_FILTER', 'Invalid filter');
const bodyPipe = strictValidationPipe('VALIDATION_FAILED', 'Invalid request');
/** A malformed id is simply a product that does not exist. */
const productIdPipe = new ParseUUIDPipe({ exceptionFactory: () => priceErrors.productNotFound() });

/** VP-11 and VP-11b · the price list and the edit of one price (HU-VEN-26). Decision #18: whoever holds `sales.prices.edit`. */
@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales/prices')
@RequirePermissions('sales.prices.edit')
export class PricesController {
  constructor(
    private readonly prices: PricesService,
    private readonly bulk: PriceBulkService,
  ) {}

  @Get()
  list(@Query(filterPipe) query: ListPricesQueryDto): Promise<PriceListResponse> {
    return this.prices.list(query);
  }

  /** VP-11c · what the bulk update would do, page by page. Writes nothing. */
  @Post('bulk/preview')
  @HttpCode(200)
  bulkPreview(@Body(bodyPipe) body: BulkPriceDto): Promise<BulkPricePreview> {
    return this.bulk.preview(body);
  }

  /** VP-11c · applies the update the user previewed (HU-VEN-27). */
  @Post('bulk/apply')
  @HttpCode(200)
  bulkApply(@Body(bodyPipe) body: BulkPriceApplyDto): Promise<BulkPriceResult> {
    return this.bulk.apply(body);
  }

  @Get(':productId')
  detail(@Param('productId', productIdPipe) productId: string): Promise<PriceDetail> {
    return this.prices.detail(productId);
  }

  @Patch(':productId')
  edit(@Param('productId', productIdPipe) productId: string, @Body(bodyPipe) body: EditPriceDto): Promise<PriceDetail> {
    return this.prices.edit(productId, body);
  }
}
