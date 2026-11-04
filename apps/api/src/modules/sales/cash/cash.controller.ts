import { BadRequestException, Body, Controller, Get, Post, Query, ValidationError, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { CashRegisterListResponse, CurrentCashShiftResponse, OpenCashShiftResponse } from '@rodasoft/domain';
import { RequirePermissions } from '../../access/require-permissions.decorator';
import { ListCashRegistersQueryDto, OpenCashShiftDto } from './cash.dto';
import { CashRegistersService } from './cash-registers.service';
import { CashShiftsService } from './cash-shifts.service';

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

@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales')
export class CashController {
  constructor(
    private readonly registers: CashRegistersService,
    private readonly shifts: CashShiftsService,
  ) {}

  @Get('cash-registers')
  @RequirePermissions('sales.cash-register.open')
  listRegisters(@Query(filterPipe) query: ListCashRegistersQueryDto): Promise<CashRegisterListResponse> {
    return this.registers.list(query);
  }

  /** Allowed with `sales.pos.use` or `sales.cash-register.open`; the service checks it (the guard only supports "all of"). */
  @Get('cash-shifts/current')
  current(): Promise<CurrentCashShiftResponse> {
    return this.shifts.current();
  }

  @Post('cash-shifts')
  @RequirePermissions('sales.cash-register.open')
  open(@Body(bodyPipe) body: OpenCashShiftDto): Promise<OpenCashShiftResponse> {
    return this.shifts.open(body);
  }
}
