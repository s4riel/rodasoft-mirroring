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
import type { PosCategoryListResponse, PosCheckoutResponse, PosProductSearchResponse } from '@rodasoft/domain';
import { RequirePermissions } from '../../access/require-permissions.decorator';
import { AddPosCheckoutItemDto, PosProductSearchQueryDto, UpdatePosCheckoutItemDto } from './pos.dto';
import { posErrors } from './pos.errors';
import { PosCatalogService } from './pos-catalog.service';
import { PosCheckoutService } from './pos-checkout.service';

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
  ) {}

  @Get('categories')
  categories(): Promise<PosCategoryListResponse> {
    return this.catalog.categories();
  }

  @Get('product-search')
  productSearch(@Query(filterPipe) query: PosProductSearchQueryDto): Promise<PosProductSearchResponse> {
    return this.catalog.search(query);
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
