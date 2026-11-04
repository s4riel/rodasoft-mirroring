import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { CustomerListResponse, CustomerSummary } from '@rodasoft/domain';
import { RequirePermissions } from '../../access/require-permissions.decorator';
import { CustomerListQueryDto, SaveCustomerDto, UpdateCustomerDto } from './customers.dto';
import { customerErrors } from './customers.errors';
import { CustomersService } from './customers.service';

function strictValidationPipe(code: string, message: string): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    exceptionFactory: (errors: ValidationError[]) =>
      new BadRequestException({ code, message, details: errors.map((e) => ({ field: e.property, constraints: e.constraints })) }),
  });
}

const filterPipe = strictValidationPipe('INVALID_FILTER', 'Invalid filter');
const bodyPipe = strictValidationPipe('VALIDATION_FAILED', 'Invalid request');
/** A malformed id is simply a customer that does not exist. */
const customerIdPipe = new ParseUUIDPipe({ exceptionFactory: () => customerErrors.notFound() });

/** HU-VEN-37 · The customer form of Management: data, NIT, credit flag and discount. */
@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales/customers')
@RequirePermissions('sales.customers.manage')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(@Query(filterPipe) query: CustomerListQueryDto): Promise<CustomerListResponse> {
    return this.customers.list(query);
  }

  @Get(':id')
  get(@Param('id', customerIdPipe) id: string): Promise<CustomerSummary> {
    return this.customers.get(id);
  }

  @Post()
  create(@Body(bodyPipe) body: SaveCustomerDto): Promise<CustomerSummary> {
    return this.customers.create(body);
  }

  @Patch(':id')
  update(@Param('id', customerIdPipe) id: string, @Body(bodyPipe) body: UpdateCustomerDto): Promise<CustomerSummary> {
    return this.customers.update(id, body);
  }
}
