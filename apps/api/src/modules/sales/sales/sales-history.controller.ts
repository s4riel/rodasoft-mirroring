import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query, ValidationError, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { SaleDetail, SaleListResponse } from '@rodasoft/domain';
import { RequireAnyPermission } from '../../access/require-permissions.decorator';
import { posErrors } from '../pos/pos.errors';
import { ListSalesQueryDto } from './sales-history.dto';
import { SalesHistoryService } from './sales-history.service';

const queryPipe = new ValidationPipe({
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
/** A malformed id is simply a sale that does not exist. */
const saleIdPipe = new ParseUUIDPipe({ exceptionFactory: () => posErrors.saleNotFound() });

/** VP-01 · the sales made, and VP-02 · the detail of one (HU-VEN-12, HU-VEN-13). */
@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales/sales')
// the history is for who sells or who may see every sale (a custom role can hold only the second)
@RequireAnyPermission('sales.pos.use', 'sales.history.view-all')
export class SalesHistoryController {
  constructor(private readonly history: SalesHistoryService) {}

  @Get()
  list(@Query(queryPipe) query: ListSalesQueryDto): Promise<SaleListResponse> {
    return this.history.list(query);
  }

  @Get(':id')
  detail(@Param('id', saleIdPipe) id: string): Promise<SaleDetail> {
    return this.history.detail(id);
  }
}
