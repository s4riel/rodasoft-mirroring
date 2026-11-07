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
import type {
  CustomerSearchResponse,
  QuoteDetail,
  QuoteEditorContext,
  QuoteListResponse,
  QuoteProductResult,
  SalesOrderDetail,
} from '@rodasoft/domain';
import { RequirePermissions } from '../../access/require-permissions.decorator';
import { SalesOrdersService } from '../orders/sales-orders.service';
import {
  ConvertQuoteDto,
  CreateQuoteDto,
  ListQuotesQueryDto,
  QuoteCustomerSearchQueryDto,
  QuoteProductSearchQueryDto,
  RenewQuoteDto,
  SendQuoteDto,
} from './quotes.dto';
import { QuoteLifecycleService } from './quote-lifecycle.service';
import { salesValidationPipe } from './sales-validation.pipe';
import { quoteErrors } from './quotes.errors';
import { QuotesService } from './quotes.service';

/** A malformed id is simply a quote that does not exist. */
const quoteIdPipe = new ParseUUIDPipe({ exceptionFactory: () => quoteErrors.quoteNotFound() });

/** VP-07 · the quotes, VP-08 · a new quote and VP-18 · converting one into an order (HU-VEN-16, HU-VEN-19). */
@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales/quotes')
export class QuotesController {
  constructor(
    private readonly quotes: QuotesService,
    private readonly orders: SalesOrdersService,
    private readonly lifecycle: QuoteLifecycleService,
  ) {}

  @Get()
  @RequirePermissions('sales.quotes.manage')
  list(@Query(salesValidationPipe) query: ListQuotesQueryDto): Promise<QuoteListResponse> {
    return this.quotes.list(query);
  }

  // fixed paths first: `context`, `customers` and `product-search` are not quote ids
  @Get('context')
  @RequirePermissions('sales.quotes.manage')
  context(): Promise<QuoteEditorContext> {
    return this.quotes.context();
  }

  @Get('customers')
  @RequirePermissions('sales.quotes.manage')
  customers(@Query(salesValidationPipe) query: QuoteCustomerSearchQueryDto): Promise<CustomerSearchResponse> {
    return this.quotes.searchCustomers(query.q ?? '');
  }

  @Get('product-search')
  @RequirePermissions('sales.quotes.manage')
  productSearch(@Query(salesValidationPipe) query: QuoteProductSearchQueryDto): Promise<{ items: QuoteProductResult[] }> {
    return this.quotes.searchProducts(query.q, query.warehouseId);
  }

  @Get(':id')
  @RequirePermissions('sales.quotes.manage')
  detail(@Param('id', quoteIdPipe) id: string): Promise<QuoteDetail> {
    return this.quotes.detail(id);
  }

  @Post()
  @RequirePermissions('sales.quotes.manage')
  create(@Body(salesValidationPipe) body: CreateQuoteDto): Promise<QuoteDetail> {
    return this.quotes.create(body);
  }

  @Post(':id/convert')
  @RequirePermissions('sales.orders.manage')
  convert(@Param('id', quoteIdPipe) id: string, @Body(salesValidationPipe) body: ConvertQuoteDto): Promise<SalesOrderDetail> {
    return this.orders.convert(id, body);
  }

  /** VP-08b · sends the quote by WhatsApp, e-mail or as a printed copy, and records it (HU-VEN-17). */
  @Post(':id/send')
  @RequirePermissions('sales.quotes.manage')
  send(@Param('id', quoteIdPipe) id: string, @Body(salesValidationPipe) body: SendQuoteDto): Promise<QuoteDetail> {
    return this.lifecycle.send(id, body);
  }

  /** VP-17b · gives an expired quote a new validity with today's prices (HU-VEN-18). */
  @Post(':id/renew')
  @RequirePermissions('sales.quotes.manage')
  renew(@Param('id', quoteIdPipe) id: string, @Body(salesValidationPipe) body: RenewQuoteDto): Promise<QuoteDetail> {
    return this.lifecycle.renew(id, body);
  }

  @Post(':id/reject')
  @RequirePermissions('sales.quotes.manage')
  reject(@Param('id', quoteIdPipe) id: string): Promise<QuoteDetail> {
    return this.lifecycle.reject(id);
  }
}
