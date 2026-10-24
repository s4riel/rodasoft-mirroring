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
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type {
  EquivalenceLinkResponse,
  EquivalenceListResponse,
  EquivalenceSuggestionsResponse,
  ProductEquivalentsResponse,
} from '@rodasoft/domain';
import { RequirePermissions } from '../access/require-permissions.decorator';
import { ListEquivalencesQueryDto, ListEquivalentsQueryDto } from './dto';
import { EquivalencesService } from './equivalences.service';
import { EquivalenceCandidatesDto, LinkEquivalenceDto } from './product-write.dto';

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
export class EquivalencesController {
  constructor(private readonly equivalences: EquivalencesService) {}

  @Get('equivalences')
  @RequirePermissions('inventory.products.view')
  listAll(@Query(queryPipe) query: ListEquivalencesQueryDto): Promise<EquivalenceListResponse> {
    return this.equivalences.list(query);
  }

  @Get('products/:id/equivalents')
  @RequirePermissions('inventory.products.view')
  list(@Param('id', idPipe) id: string, @Query(queryPipe) query: ListEquivalentsQueryDto): Promise<ProductEquivalentsResponse> {
    return this.equivalences.listForProduct(id, query);
  }

  @Get('products/:id/equivalence-suggestions')
  @RequirePermissions('inventory.products.view')
  suggestions(@Param('id', idPipe) id: string): Promise<EquivalenceSuggestionsResponse> {
    return this.equivalences.suggestions(id);
  }

  @Post('equivalence-candidates')
  @HttpCode(200)
  @RequirePermissions('inventory.products.edit')
  candidates(@Body(bodyPipe) body: EquivalenceCandidatesDto): Promise<EquivalenceSuggestionsResponse> {
    return this.equivalences.candidates(body);
  }

  @Post('equivalences')
  @RequirePermissions('inventory.equivalences.link')
  link(@Body(bodyPipe) body: LinkEquivalenceDto): Promise<EquivalenceLinkResponse> {
    return this.equivalences.link(body);
  }
}
