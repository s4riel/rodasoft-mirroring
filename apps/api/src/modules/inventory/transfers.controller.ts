import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import {
  TRANSFER_FILE_MAX_BYTES,
  type TransferDetail,
  type TransferListResponse,
  type TransferProductSearchResponse,
  type TransferResolveResponse,
  type TransferWarehousesResponse,
} from '@rodasoft/domain';
import { RequirePermissions } from '../access/require-permissions.decorator';
import { ListTransfersQueryDto, ProductSearchQueryDto, ResolveLinesDto, SaveTransferDto, SendTransferDto } from './transfers.dto';
import { type TransferUploadFile, TransfersService } from './transfers.service';
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
 * Transfers between warehouses (HU-INV-18). Reading is for whoever creates or receives transfers (checked in the service,
 * since the guard requires every listed permission); writing needs `inventory.transfers.create`.
 */
@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory/transfers')
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Get()
  list(@Query(filterPipe) query: ListTransfersQueryDto): Promise<TransferListResponse> {
    return this.transfers.list(query);
  }

  // the fixed paths come before `:id`, which would otherwise swallow them

  @Get('warehouses')
  @RequirePermissions('inventory.transfers.create')
  warehouses(): Promise<TransferWarehousesResponse> {
    return this.transfers.warehouses();
  }

  @Get('product-search')
  @RequirePermissions('inventory.transfers.create')
  productSearch(@Query(filterPipe) query: ProductSearchQueryDto): Promise<TransferProductSearchResponse> {
    return this.transfers.productSearch(query);
  }

  /** Pasted text (`text`) or an uploaded .xlsx/.csv (`file`) with `code` and `quantity`; nothing is saved. */
  @Post('resolve-lines')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data', 'application/json')
  @RequirePermissions('inventory.transfers.create')
  @UseInterceptors(UploadLimitInterceptor, FileInterceptor('file', { limits: { fileSize: TRANSFER_FILE_MAX_BYTES, files: 1 } }))
  resolveLines(@UploadedFile() file: TransferUploadFile | undefined, @Body(bodyPipe) body: ResolveLinesDto): Promise<TransferResolveResponse> {
    return this.transfers.resolveLines(body, file);
  }

  @Get(':id')
  get(@Param('id', idPipe) id: string): Promise<TransferDetail> {
    return this.transfers.get(id);
  }

  @Post()
  @RequirePermissions('inventory.transfers.create')
  create(@Body(bodyPipe) body: SaveTransferDto): Promise<TransferDetail> {
    return this.transfers.create(body);
  }

  @Put(':id')
  @RequirePermissions('inventory.transfers.create')
  update(@Param('id', idPipe) id: string, @Body(bodyPipe) body: SaveTransferDto): Promise<TransferDetail> {
    return this.transfers.update(id, body);
  }

  @Post(':id/send')
  @HttpCode(200)
  @RequirePermissions('inventory.transfers.create')
  send(@Param('id', idPipe) id: string, @Body(bodyPipe) body: SendTransferDto): Promise<TransferDetail> {
    return this.transfers.send(id, body);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('inventory.transfers.create')
  cancel(@Param('id', idPipe) id: string): Promise<TransferDetail> {
    return this.transfers.cancel(id);
  }
}
