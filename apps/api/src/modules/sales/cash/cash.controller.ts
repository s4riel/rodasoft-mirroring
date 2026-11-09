import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type {
  CashMovementDetail,
  CashRegisterListResponse,
  CashShiftDetail,
  CloseCashShiftResponse,
  CurrentCashShiftResponse,
  OpenCashShiftResponse,
} from '@rodasoft/domain';
import { RequireAnyPermission, RequirePermissions } from '../../access/require-permissions.decorator';
import { CashMovementDecisionDto, CloseCashShiftDto, CreateCashMovementDto, ListCashRegistersQueryDto, OpenCashShiftDto } from './cash.dto';
import { cashMovementErrors } from './cash.errors';
import { CashClosingService } from './cash-closing.service';
import { CashMovementsService } from './cash-movements.service';
import { CashRegistersService } from './cash-registers.service';
import { CashShiftSummaryService } from './cash-shift-summary.service';
import { CashShiftsService } from './cash-shifts.service';
import { RECEIPT_PARSE_LIMIT_BYTES, ReceiptLimitInterceptor } from './cash-receipt.interceptor';

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
const shiftIdPipe = new ParseUUIDPipe({ exceptionFactory: () => cashMovementErrors.shiftNotFound() });
const movementIdPipe = new ParseUUIDPipe({ exceptionFactory: () => cashMovementErrors.movementNotFound() });

/** The part of a multipart file the controller reads (memory storage). */
interface UploadedBinary {
  buffer: Buffer;
}

function requireKey(idempotencyKey: string | undefined): string {
  const key = idempotencyKey?.trim();
  if (!key || key.length > 100) throw cashMovementErrors.idempotencyKeyRequired();
  return key;
}

@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales')
export class CashController {
  constructor(
    private readonly registers: CashRegistersService,
    private readonly shifts: CashShiftsService,
    private readonly summary: CashShiftSummaryService,
    private readonly movements: CashMovementsService,
    private readonly closing: CashClosingService,
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

  /** VP-22 and VP-06 · the shift with its sales per method and the cash it should hold. The cashier's own, or any for a reviewer. */
  @Get('cash-shifts/:id')
  @RequireAnyPermission('sales.cash-register.open', 'sales.cash-register.review')
  shift(@Param('id', shiftIdPipe) id: string): Promise<CashShiftDetail> {
    return this.summary.shiftDetail(id);
  }

  /** VP-22b · registers an income or an expense, with an optional receipt. The `Idempotency-Key` header makes a repeat harmless. */
  @Post('cash-shifts/:id/movements')
  @ApiConsumes('multipart/form-data')
  @RequirePermissions('sales.cash-register.open')
  @UseInterceptors(ReceiptLimitInterceptor, FileInterceptor('receipt', { limits: { fileSize: RECEIPT_PARSE_LIMIT_BYTES, files: 1 } }))
  createMovement(
    @Param('id', shiftIdPipe) id: string,
    @Body(bodyPipe) body: CreateCashMovementDto,
    @UploadedFile() receipt: UploadedBinary | undefined,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<CashMovementDetail> {
    return this.movements.create(id, body, receipt, requireKey(idempotencyKey));
  }

  /** VP-06 · closes the shift with the count and the declared QR, card and transfer. */
  @Post('cash-shifts/:id/close')
  @RequirePermissions('sales.cash-register.open')
  close(@Param('id', shiftIdPipe) id: string, @Body(bodyPipe) body: CloseCashShiftDto): Promise<CloseCashShiftResponse> {
    return this.closing.close(id, body);
  }
}

/** The manual movements of a shift and the approval of the expenses above the limit (decision #16). */
@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales/cash-movements')
export class CashMovementsController {
  constructor(
    private readonly summary: CashShiftSummaryService,
    private readonly movements: CashMovementsService,
  ) {}

  /** Visible to who registered it and to who approves expenses; the service hides it from anyone else. */
  @Get(':id')
  @RequireAnyPermission('sales.cash-register.open', 'sales.cash-expenses.approve')
  detail(@Param('id', movementIdPipe) id: string): Promise<CashMovementDetail> {
    return this.summary.movementDetail(id);
  }

  @Get(':id/receipt')
  @RequireAnyPermission('sales.cash-register.open', 'sales.cash-expenses.approve')
  receipt(@Param('id', movementIdPipe) id: string): Promise<StreamableFile> {
    return this.summary.receipt(id);
  }

  @Post(':id/approve')
  @RequirePermissions('sales.cash-expenses.approve')
  approve(@Param('id', movementIdPipe) id: string, @Body(bodyPipe) body: CashMovementDecisionDto): Promise<CashMovementDetail> {
    return this.movements.approve(id, body);
  }

  @Post(':id/reject')
  @RequirePermissions('sales.cash-expenses.approve')
  reject(@Param('id', movementIdPipe) id: string, @Body(bodyPipe) body: CashMovementDecisionDto): Promise<CashMovementDetail> {
    return this.movements.reject(id, body);
  }

  /** Only who registered the expense, and only while it waits. */
  @Post(':id/withdraw')
  @RequirePermissions('sales.cash-register.open')
  withdraw(@Param('id', movementIdPipe) id: string): Promise<CashMovementDetail> {
    return this.movements.withdraw(id);
  }
}
