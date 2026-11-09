import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import {
  QUOTE_MAX_LINES,
  QUOTE_MAX_QUANTITY,
  RETURN_COMMENT_MAX,
  RETURN_CONDITIONS,
  RETURN_REFERENCE_MAX,
  SALES_DOCUMENT_PAGE_SIZE_MAX,
  type CreateSaleReturnInput,
  type ReturnCondition,
  type ReturnDecisionInput,
  type SaleReturnStatus,
} from '@rodasoft/domain';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const RETURN_STATUSES: SaleReturnStatus[] = ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'];

export class ReturnLineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  saleItemId!: string;

  @ApiProperty({ minimum: 0, maximum: QUOTE_MAX_QUANTITY })
  @IsInt()
  @Min(0)
  @Max(QUOTE_MAX_QUANTITY)
  quantity!: number;

  @ApiProperty({ enum: RETURN_CONDITIONS })
  @IsIn(RETURN_CONDITIONS)
  condition!: ReturnCondition;
}

/** `reason` and `refundMethod` are plain strings here: the domain rules answer them with the project's validation errors. */
export class CreateSaleReturnDto implements CreateSaleReturnInput {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  saleId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(40)
  reason!: string;

  @ApiPropertyOptional({ maxLength: RETURN_COMMENT_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(RETURN_COMMENT_MAX * 2)
  comment?: string | null;

  @ApiProperty()
  @IsString()
  @MaxLength(40)
  refundMethod!: string;

  @ApiPropertyOptional({ maxLength: RETURN_REFERENCE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(RETURN_REFERENCE_MAX * 2)
  refundReference?: string | null;

  @ApiProperty({ type: [ReturnLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(QUOTE_MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  items!: ReturnLineDto[];
}

export class ReturnDecisionDto implements ReturnDecisionInput {
  @ApiPropertyOptional({ maxLength: RETURN_COMMENT_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(RETURN_COMMENT_MAX * 2)
  comment?: string;
}

export class ListReturnsQueryDto {
  @ApiPropertyOptional({ enum: RETURN_STATUSES })
  @IsOptional()
  @IsIn(RETURN_STATUSES)
  status?: SaleReturnStatus;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: SALES_DOCUMENT_PAGE_SIZE_MAX })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SALES_DOCUMENT_PAGE_SIZE_MAX)
  pageSize?: number;
}

export class SaleLookupQueryDto {
  @ApiProperty({ description: 'The sale number or the NIT / document of the customer' })
  @Transform(trimmed)
  @IsString()
  @MaxLength(60)
  q!: string;
}
