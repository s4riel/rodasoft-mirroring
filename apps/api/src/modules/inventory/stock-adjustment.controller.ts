import { BadRequestException, Body, Controller, Param, ParseUUIDPipe, Post, ValidationError, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { QuickAdjustmentResponse } from '@rodasoft/domain';
import { RequirePermissions } from '../access/require-permissions.decorator';
import { QuickAdjustmentDto } from './stock-adjustment.dto';
import { StockAdjustmentService } from './stock-adjustment.service';

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

const idPipe = new ParseUUIDPipe({
  exceptionFactory: () => new BadRequestException({ code: 'INVALID_ID', message: 'Invalid id' }),
});

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory')
export class StockAdjustmentController {
  constructor(private readonly adjustments: StockAdjustmentService) {}

  @Post('products/:id/stock-adjustments')
  @RequirePermissions('inventory.adjustments.create')
  quickAdjust(@Param('id', idPipe) id: string, @Body(bodyPipe) body: QuickAdjustmentDto): Promise<QuickAdjustmentResponse> {
    return this.adjustments.quickAdjust(id, body);
  }
}
