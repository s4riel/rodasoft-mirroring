import { BadRequestException, Controller, Get, Header, Query, StreamableFile, ValidationError, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { KardexLedgerResponse, KardexResponse } from '@rodasoft/domain';
import { RequirePermissions } from '../access/require-permissions.decorator';
import { KardexExportQueryDto, KardexQueryDto } from './kardex.dto';
import { KardexLedgerService } from './kardex-ledger.service';
import { KardexService } from './kardex.service';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const filterPipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: (errors: ValidationError[]) =>
    new BadRequestException({
      code: 'INVALID_FILTER',
      message: 'Invalid filter',
      details: errors.map((e) => ({ field: e.property, constraints: e.constraints })),
    }),
});

/** Kardex of a product (HU-INV-24): its movements in time order with the balance, filtered by warehouse and dates. */
@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory/kardex')
export class KardexController {
  constructor(
    private readonly kardex: KardexService,
    private readonly ledger: KardexLedgerService,
  ) {}

  /** With `productId`: the kardex of that product. Without it: the ledger of every movement. */
  @Get()
  @RequirePermissions('inventory.kardex.view')
  get(@Query(filterPipe) query: KardexQueryDto): Promise<KardexResponse | KardexLedgerResponse> {
    return query.productId ? this.kardex.kardex({ ...query, productId: query.productId }) : this.ledger.ledger(query);
  }

  /** The same kardex or ledger as an .xlsx, the whole range (no pages). */
  @Get('export')
  @RequirePermissions('inventory.kardex.view')
  @Header('Content-Type', XLSX_TYPE)
  async export(@Query(filterPipe) query: KardexExportQueryDto): Promise<StreamableFile> {
    const { file, name } = query.productId ? await this.kardex.export({ ...query, productId: query.productId }) : await this.ledger.export(query);
    return new StreamableFile(file, { disposition: `attachment; filename="${name}"` });
  }
}
