import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import {
  type AdjustmentDetail,
  type AdjustmentListResponse,
  type AdjustmentProductSearchResponse,
  type AdjustmentResolveResponse,
  type CreateAdjustmentResponse,
  TRANSFER_FILE_MAX_BYTES,
} from '@rodasoft/domain';
import { RequirePermissions } from '../access/require-permissions.decorator';
import type { ListUploadFile } from './list-file';
import { AdjustmentProductSearchQueryDto, CreateAdjustmentDto, ListAdjustmentsQueryDto, ResolveAdjustmentLinesDto } from './stock-adjustments.dto';
import { StockAdjustmentsService } from './stock-adjustments.service';
import { UploadLimitInterceptor } from './uploads.controller';

function strictValidationPipe(code: string, message: string): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    exceptionFactory: (errors: ValidationError[]) =>
      new BadRequestException({
        code,
        message,
        details: errors.map((e) => ({ field: e.property, constraints: e.constraints })),
      }),
  });
}

const filterPipe = strictValidationPipe('INVALID_FILTER', 'Invalid filter');
const bodyPipe = strictValidationPipe('VALIDATION_FAILED', 'Invalid request');

const idPipe = new ParseUUIDPipe({
  exceptionFactory: () => new BadRequestException({ code: 'INVALID_ID', message: 'Invalid id' }),
});

/**
 * Stock adjustment documents (HU-INV-22). Reading is for whoever creates or approves adjustments (checked in the service,
 * since the guard requires every listed permission); creating needs `inventory.adjustments.create`.
 */
@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory/adjustments')
export class StockAdjustmentsController {
  constructor(private readonly adjustments: StockAdjustmentsService) {}

  @Get()
  list(@Query(filterPipe) query: ListAdjustmentsQueryDto): Promise<AdjustmentListResponse> {
    return this.adjustments.list(query);
  }

  // declared before `:id` so "product-search" is not read as an id
  @Get('product-search')
  productSearch(@Query(filterPipe) query: AdjustmentProductSearchQueryDto): Promise<AdjustmentProductSearchResponse> {
    return this.adjustments.productSearch(query);
  }

  /** Pasted text (`text`) or an uploaded .xlsx/.csv (`file`) with `code`, `quantity` and an optional kind; nothing is saved. */
  @Post('resolve-lines')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data', 'application/json')
  @RequirePermissions('inventory.adjustments.create')
  @UseInterceptors(UploadLimitInterceptor, FileInterceptor('file', { limits: { fileSize: TRANSFER_FILE_MAX_BYTES, files: 1 } }))
  resolveLines(@UploadedFile() file: ListUploadFile | undefined, @Body(bodyPipe) body: ResolveAdjustmentLinesDto): Promise<AdjustmentResolveResponse> {
    return this.adjustments.resolveLines(body, file);
  }

  @Get(':id')
  get(@Param('id', idPipe) id: string): Promise<AdjustmentDetail> {
    return this.adjustments.get(id);
  }

  @Post()
  @RequirePermissions('inventory.adjustments.create')
  create(@Body(bodyPipe) body: CreateAdjustmentDto): Promise<CreateAdjustmentResponse> {
    return this.adjustments.create(body);
  }
}
