import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CASH_COUNT_MAX,
  CASH_DETAIL_MAX,
  CLOSING_COMMENT_MAX,
  type CashCountInput,
  type CashMovementDecisionInput,
  type CloseCashShiftInput,
  type CreateCashMovementInput,
  type DeclaredMethod,
  type OpenCashShiftInput,
} from '@rodasoft/domain';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ListCashRegistersQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class OpenCashShiftDto implements OpenCashShiftInput {
  @ApiProperty()
  @IsUUID()
  registerId!: string;

  @ApiProperty({ example: '500.00', description: 'Decimal string, never a JSON number' })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  openingFloat!: string;
}

/**
 * The text fields of `POST /sales/cash-shifts/:id/movements` (multipart, so everything arrives as text). The type, the amount and
 * the concept are plain strings here: the domain rules answer them with the project's cash error codes.
 */
export class CreateCashMovementDto implements CreateCashMovementInput {
  @ApiProperty({ enum: ['INCOME', 'EXPENSE'] })
  @Transform(trimmed)
  @IsString()
  @MaxLength(20)
  type!: string;

  @ApiProperty({ example: '50.00', description: 'Decimal string, never a JSON number' })
  @Transform(trimmed)
  @IsString()
  @MaxLength(20)
  amount!: string;

  @ApiProperty({ example: 'FREIGHT' })
  @Transform(trimmed)
  @IsString()
  @MaxLength(40)
  concept!: string;

  @ApiPropertyOptional({ maxLength: CASH_DETAIL_MAX * 2 })
  @IsOptional()
  @IsString()
  // twice the limit: the domain rule answers an over-long detail with its own code
  @MaxLength(CASH_DETAIL_MAX * 2)
  detail?: string;
}

/** The reply to an expense that was waiting for approval; rejecting needs it. */
export class CashMovementDecisionDto implements CashMovementDecisionInput {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class CashCountDto implements CashCountInput {
  @ApiProperty({ example: '50.00' })
  @Transform(trimmed)
  @IsString()
  @MaxLength(20)
  denomination!: string;

  /** The domain rule answers a fraction, a negative or an over-large quantity with `INVALID_COUNT`. */
  @ApiProperty({ minimum: 0, maximum: CASH_COUNT_MAX })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  quantity!: number;
}

export class DeclaredAmountsDto implements Record<DeclaredMethod, string> {
  @ApiProperty({ example: '0.00' })
  @Transform(trimmed)
  @IsString()
  @MaxLength(20)
  QR!: string;

  @ApiProperty({ example: '0.00' })
  @Transform(trimmed)
  @IsString()
  @MaxLength(20)
  CARD!: string;

  @ApiProperty({ example: '0.00' })
  @Transform(trimmed)
  @IsString()
  @MaxLength(20)
  TRANSFER!: string;
}

export class CloseCashShiftDto implements CloseCashShiftInput {
  @ApiProperty({ type: [CashCountDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CashCountDto)
  counts!: CashCountDto[];

  @ApiProperty({ type: DeclaredAmountsDto })
  @ValidateNested()
  @Type(() => DeclaredAmountsDto)
  declared!: DeclaredAmountsDto;

  @ApiProperty({ example: '500.00', description: 'Cash that stays in the register for the next shift' })
  @Transform(trimmed)
  @IsString()
  @MaxLength(20)
  closingFloat!: string;

  @ApiPropertyOptional({ maxLength: CLOSING_COMMENT_MAX * 2 })
  @IsOptional()
  @IsString()
  // twice the limit: the domain rule answers an over-long comment with its own code
  @MaxLength(CLOSING_COMMENT_MAX * 2)
  comment?: string;
}
