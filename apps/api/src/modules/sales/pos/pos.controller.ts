import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { PosCategoryListResponse, PosCheckoutResponse, PosEquivalentsResponse, PosProductSearchResponse, PosProductSheet } from '@rodasoft/domain';
import { RequirePermissions } from '../../access/require-permissions.decorator';
import { AddPosCheckoutItemDto, PosProductSearchQueryDto, UpdatePosCheckoutItemDto } from './pos.dto';
import { posErrors } from './pos.errors';
import { PosCatalogService } from './pos-catalog.service';
import { PosCheckoutService } from './pos-checkout.service';
import { PosEquivalentsService } from './pos-equivalents.service';
import { PosProductSheetService } from './pos-product-sheet.service';

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
/** A malformed product id is simply a product that does not exist. */
const productIdPipe = new ParseUUIDPipe({ exceptionFactory: () => posErrors.productNotFound() });
/** Another cashier's line, or a malformed id, is simply a line that does not exist. */
const itemIdPipe = new ParseUUIDPipe({ exceptionFactory: () => posErrors.itemNotFound() });

/** VP-03 · POS search and cart (HU-VEN-02). Every call needs an open cash shift of the caller (`CASH_SHIFT_NOT_OPEN`). */
@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales/pos')
@RequirePermissions('sales.pos.use')
export class PosController {
  constructor(
    private readonly catalog: PosCatalogService,
    private readonly checkout: PosCheckoutService,
    private readonly equivalents: PosEquivalentsService,
    private readonly sheets: PosProductSheetService,
  ) {}

  @Get('categories')
  categories(): Promise<PosCategoryListResponse> {
    return this.catalog.categories();
  }

  @Get('product-search')
  productSearch(@Query(filterPipe) query: PosProductSearchQueryDto): Promise<PosProductSearchResponse> {
    return this.catalog.search(query);
  }

  /** VP-03b (HU-VEN-03): in-stock equivalents of a product, and where the original is in stock. */
  @Get('products/:id/equivalents')
  productEquivalents(@Param('id', productIdPipe) id: string): Promise<PosEquivalentsResponse> {
    return this.equivalents.list(id);
  }

  /** VP-03e (HU-VEN-04): the technical sheet of a product, without costs. */
  @Get('products/:id/sheet')
  productSheet(@Param('id', productIdPipe) id: string): Promise<PosProductSheet> {
    return this.sheets.sheet(id);
  }

  @Get('checkout')
  current(): Promise<PosCheckoutResponse> {
    return this.checkout.current();
  }

  @Post('checkout/items')
  addItem(@Body(bodyPipe) body: AddPosCheckoutItemDto): Promise<PosCheckoutResponse> {
    return this.checkout.addItem(body);
  }

  @Patch('checkout/items/:id')
  updateItem(@Param('id', itemIdPipe) id: string, @Body(bodyPipe) body: UpdatePosCheckoutItemDto): Promise<PosCheckoutResponse> {
    return this.checkout.updateItem(id, body);
  }

  @Delete('checkout/items/:id')
  removeItem(@Param('id', itemIdPipe) id: string): Promise<PosCheckoutResponse> {
    return this.checkout.removeItem(id);
  }
}
