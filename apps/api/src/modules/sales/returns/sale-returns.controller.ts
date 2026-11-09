import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { ReturnableSale, SaleReturnDetail, SaleReturnList } from '@rodasoft/domain';
import { RequireAnyPermission, RequirePermissions } from '../../access/require-permissions.decorator';
import { salesValidationPipe } from '../quotes/sales-validation.pipe';
import { CreateSaleReturnDto, ListReturnsQueryDto, ReturnDecisionDto, SaleLookupQueryDto } from './sale-returns.dto';
import { returnErrors } from './sale-returns.errors';
import { SaleReturnsService } from './sale-returns.service';
import { SaleReturnsQueryService } from './sale-returns-query.service';

const returnIdPipe = new ParseUUIDPipe({ exceptionFactory: () => returnErrors.returnNotFound() });

/** VP-20 · the returns, VP-10 · registering one, VP-21 · its detail and the decision of Management (HU-VEN-21). */
@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales/returns')
export class SaleReturnsController {
  constructor(
    private readonly returns: SaleReturnsService,
    private readonly queries: SaleReturnsQueryService,
  ) {}

  @Get()
  @RequirePermissions('sales.returns.manage')
  list(@Query(salesValidationPipe) query: ListReturnsQueryDto): Promise<SaleReturnList> {
    return this.queries.list(query);
  }

  @Get('sale-lookup')
  @RequirePermissions('sales.returns.manage')
  lookup(@Query(salesValidationPipe) query: SaleLookupQueryDto): Promise<ReturnableSale> {
    return this.queries.lookup(query.q);
  }

  /** The `Idempotency-Key` header makes a repeated request harmless. */
  @Post()
  @RequirePermissions('sales.returns.manage')
  create(@Body(salesValidationPipe) body: CreateSaleReturnDto, @Headers('idempotency-key') idempotencyKey?: string): Promise<SaleReturnDetail> {
    const key = idempotencyKey?.trim();
    if (!key || key.length > 100) throw returnErrors.idempotencyKeyRequired();
    return this.returns.create(body, key);
  }

  @Get(':id')
  @RequireAnyPermission('sales.returns.manage', 'sales.returns.approve')
  detail(@Param('id', returnIdPipe) id: string): Promise<SaleReturnDetail> {
    return this.queries.detail(id);
  }

  @Post(':id/approve')
  @RequirePermissions('sales.returns.approve')
  approve(@Param('id', returnIdPipe) id: string, @Body(salesValidationPipe) body: ReturnDecisionDto): Promise<SaleReturnDetail> {
    return this.returns.approve(id, body);
  }

  @Post(':id/reject')
  @RequirePermissions('sales.returns.approve')
  reject(@Param('id', returnIdPipe) id: string, @Body(salesValidationPipe) body: ReturnDecisionDto): Promise<SaleReturnDetail> {
    return this.returns.reject(id, body);
  }
}
