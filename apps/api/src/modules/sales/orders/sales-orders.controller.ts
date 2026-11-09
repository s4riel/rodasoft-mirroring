import {
  Body,
  Controller,
  Get,
  Headers,
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
import { CreateDispatchDto } from './sales-order-dispatch.dto';
import { dispatchErrors } from './sales-order-dispatch.errors';
import { SalesOrderDispatchService } from './sales-order-dispatch.service';
import { SalesOrdersService } from './sales-orders.service';

const orderIdPipe = new ParseUUIDPipe({ exceptionFactory: () => quoteErrors.salesOrderNotFound() });

/** VP-09 · the orders and their detail; cancelling one gives its reservation back (HU-VEN-19); dispatching one in parts invoices each part (HU-VEN-20). */
@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales/orders')
@RequirePermissions('sales.orders.manage')
export class SalesOrdersController {
  constructor(
    private readonly orders: SalesOrdersService,
    private readonly dispatches: SalesOrderDispatchService,
  ) {}

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

  /** VP-19b · dispatch and invoice the chosen quantities. The `Idempotency-Key` header makes a repeated request harmless. */
  @Post(':id/dispatches')
  dispatch(
    @Param('id', orderIdPipe) id: string,
    @Body(salesValidationPipe) body: CreateDispatchDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<SalesOrderDetail> {
    const key = idempotencyKey?.trim();
    if (!key || key.length > 100) throw dispatchErrors.idempotencyKeyRequired();
    return this.dispatches.dispatch(id, body, key);
  }
}
