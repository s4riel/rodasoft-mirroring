import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, ValidationError, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { WarehouseDetail, WarehouseListResponse, WarehouseSaveResponse } from '@rodasoft/domain';
import { RequirePermissions } from '../access/require-permissions.decorator';
import { CreateWarehouseDto, ListWarehousesQueryDto, UpdateWarehouseDto } from './warehouses.dto';
import { WarehousesService } from './warehouses.service';

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

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory/warehouses')
export class WarehousesController {
  constructor(private readonly warehouses: WarehousesService) {}

  @Get()
  @RequirePermissions('inventory.products.view')
  list(@Query(filterPipe) query: ListWarehousesQueryDto): Promise<WarehouseListResponse> {
    return this.warehouses.list(query);
  }

  @Get(':id')
  @RequirePermissions('inventory.products.view')
  detail(@Param('id', idPipe) id: string): Promise<WarehouseDetail> {
    return this.warehouses.detail(id);
  }

  @Post()
  @RequirePermissions('inventory.warehouses.manage')
  create(@Body(bodyPipe) body: CreateWarehouseDto): Promise<WarehouseSaveResponse> {
    return this.warehouses.create(body);
  }

  @Patch(':id')
  @RequirePermissions('inventory.warehouses.manage')
  update(@Param('id', idPipe) id: string, @Body(bodyPipe) body: UpdateWarehouseDto): Promise<WarehouseSaveResponse> {
    return this.warehouses.update(id, body);
  }
}
