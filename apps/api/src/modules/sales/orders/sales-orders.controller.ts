import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { SalesOrderDetail, SalesOrderListResponse } from '@rodasoft/domain';
import { RequirePermissions } from '../../access/require-permissions.decorator';
import { CancelSalesOrderDto, ListSalesOrdersQueryDto } from '../quotes/quotes.dto';
import { quoteErrors } from '../quotes/quotes.errors';
import { salesValidationPipe } from '../quotes/sales-validation.pipe';
import { SalesOrdersService } from './sales-orders.service';

const orderIdPipe = new ParseUUIDPipe({ exceptionFactory: () => quoteErrors.salesOrderNotFound() });

/** VP-09 · the orders and their detail; cancelling one gives its reservation back (HU-VEN-19). */
@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales/orders')
@RequirePermissions('sales.orders.manage')
export class SalesOrdersController {
  constructor(private readonly orders: SalesOrdersService) {}

  @Get()
  list(@Query(salesValidationPipe) query: ListSalesOrdersQueryDto): Promise<SalesOrderListResponse> {
    return this.orders.list(query);
  }

  @Get(':id')
  detail(@Param('id', orderIdPipe) id: string): Promise<SalesOrderDetail> {
    return this.orders.detail(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id', orderIdPipe) id: string, @Body(salesValidationPipe) body: CancelSalesOrderDto): Promise<SalesOrderDetail> {
    return this.orders.cancel(id, body.reason);
  }
}
