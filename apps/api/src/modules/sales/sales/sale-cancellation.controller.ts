import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, ValidationError, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { CancellationReview, SaleCancellationResponse } from '@rodasoft/domain';
import { RequireAnyPermission, RequirePermissions } from '../../access/require-permissions.decorator';
import { posErrors } from '../pos/pos.errors';
import { CancellationDecisionDto, CancellationRequestDto } from './sale-cancellation.dto';
import { SaleCancellationService } from './sale-cancellation.service';

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
/** A malformed id is simply a sale that does not exist. */
const saleIdPipe = new ParseUUIDPipe({ exceptionFactory: () => posErrors.saleNotFound() });

/** VP-15a · asking for the cancellation of a sale and taking the request back (HU-VEN-14); VP-15c · Management deciding it (HU-VEN-15). */
@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales/sales')
export class SaleCancellationController {
  constructor(private readonly cancellations: SaleCancellationService) {}

  @Post(':id/cancellation-request')
  @RequirePermissions('sales.cancellations.request')
  request(@Param('id', saleIdPipe) id: string, @Body(bodyPipe) body: CancellationRequestDto): Promise<SaleCancellationResponse> {
    return this.cancellations.request(id, body);
  }

  // who may approve cancellations can also take a request back, even without asking for cancellations themselves
  @Post(':id/cancellation-request/withdraw')
  @RequireAnyPermission('sales.cancellations.request', 'sales.cancellations.approve')
  withdraw(@Param('id', saleIdPipe) id: string): Promise<SaleCancellationResponse> {
    return this.cancellations.withdraw(id);
  }

  /** The request with what an approval will do, for the page where Management decides. */
  @Get(':id/cancellation-request')
  @RequirePermissions('sales.cancellations.approve')
  review(@Param('id', saleIdPipe) id: string): Promise<CancellationReview> {
    return this.cancellations.review(id);
  }

  @Post(':id/cancellation-request/approve')
  @RequirePermissions('sales.cancellations.approve')
  approve(@Param('id', saleIdPipe) id: string, @Body(bodyPipe) body: CancellationDecisionDto): Promise<SaleCancellationResponse> {
    return this.cancellations.approve(id, body);
  }

  @Post(':id/cancellation-request/reject')
  @RequirePermissions('sales.cancellations.approve')
  reject(@Param('id', saleIdPipe) id: string, @Body(bodyPipe) body: CancellationDecisionDto): Promise<SaleCancellationResponse> {
    return this.cancellations.reject(id, body);
  }
}
