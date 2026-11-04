import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, ValidationError, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { SaleReceipt, SendReceiptEmailResponse } from '@rodasoft/domain';
import { RequirePermissions } from '../../access/require-permissions.decorator';
import { SendReceiptEmailDto } from '../pos/pos-payment.dto';
import { posErrors } from '../pos/pos.errors';
import { SaleReceiptService } from './sale-receipt.service';

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

/** VP-16a · the receipt of a completed sale (HU-VEN-11). */
@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales/sales')
@RequirePermissions('sales.pos.use')
export class SaleReceiptController {
  constructor(private readonly receipts: SaleReceiptService) {}

  @Get(':id/receipt')
  receipt(@Param('id', saleIdPipe) id: string): Promise<SaleReceipt> {
    return this.receipts.receipt(id);
  }

  @Post(':id/receipt/email')
  sendEmail(@Param('id', saleIdPipe) id: string, @Body(bodyPipe) body: SendReceiptEmailDto): Promise<SendReceiptEmailResponse> {
    return this.receipts.sendEmail(id, body.email);
  }
}
