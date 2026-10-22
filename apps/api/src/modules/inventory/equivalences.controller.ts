import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { ProductEquivalentsResponse } from '@rodasoft/domain';
import { RequirePermissions } from '../access/require-permissions.decorator';
import { ListEquivalentsQueryDto } from './dto';
import { EquivalencesService } from './equivalences.service';

const queryPipe = new ValidationPipe({
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

const idPipe = new ParseUUIDPipe({
  exceptionFactory: () => new BadRequestException({ code: 'INVALID_ID', message: 'Invalid id' }),
});

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory')
export class EquivalencesController {
  constructor(private readonly equivalences: EquivalencesService) {}

  @Get('products/:id/equivalents')
  @RequirePermissions('inventory.products.view')
  list(@Param('id', idPipe) id: string, @Query(queryPipe) query: ListEquivalentsQueryDto): Promise<ProductEquivalentsResponse> {
    return this.equivalences.listForProduct(id, query);
  }
}
