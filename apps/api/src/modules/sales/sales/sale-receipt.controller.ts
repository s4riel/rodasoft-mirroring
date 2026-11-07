import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, ValidationError, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { ReprintReceiptResponse, SaleReceipt, SendReceiptEmailResponse } from '@rodasoft/domain';
import { RequireAnyPermission } from '../../access/require-permissions.decorator';
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
// the receipt is also reached from the sales history, so view-all alone is enough
@RequireAnyPermission('sales.pos.use', 'sales.history.view-all')
export class SaleReceiptController {
  constructor(private readonly receipts: SaleReceiptService) {}

  @Get(':id/receipt')
  receipt(@Param('id', saleIdPipe) id: string): Promise<SaleReceipt> {
    return this.receipts.receipt(id);
  }

  @Post(':id/receipt/reprint')
  reprint(@Param('id', saleIdPipe) id: string): Promise<ReprintReceiptResponse> {
    return this.receipts.reprint(id);
  }

  @Post(':id/receipt/email')
  sendEmail(@Param('id', saleIdPipe) id: string, @Body(bodyPipe) body: SendReceiptEmailDto): Promise<SendReceiptEmailResponse> {
    return this.receipts.sendEmail(id, body.email);
  }
}
