import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ADJUSTMENT_KINDS,
  ADJUSTMENT_LINE_QUANTITY_MAX,
  ADJUSTMENT_LINES_MAX,
  ADJUSTMENT_NOTE_MAX,
  ADJUSTMENT_PAGE_SIZE_MAX,
  ADJUSTMENT_REASONS,
  type AdjustmentKind,
  type AdjustmentReason,
  type StockAdjustmentDocumentStatus,
} from '@rodasoft/domain';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';

const STATUSES: StockAdjustmentDocumentStatus[] = ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'];

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ListAdjustmentsQueryDto {
  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: StockAdjustmentDocumentStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ enum: ADJUSTMENT_REASONS })
  @IsOptional()
  @IsIn(ADJUSTMENT_REASONS)
  reason?: AdjustmentReason;

  @ApiPropertyOptional({ description: 'Created on or after this day (ISO date)' })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({ description: 'Created on or before this day (ISO date)' })
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  @ApiPropertyOptional({ description: 'Matches the adjustment number or the code of a product on it' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(40)
  q?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: ADJUSTMENT_PAGE_SIZE_MAX })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ADJUSTMENT_PAGE_SIZE_MAX)
  pageSize?: number;
}

export class AdjustmentProductSearchQueryDto {
  @ApiProperty()
  @IsUUID()
  warehouseId!: string;

  @ApiProperty()
  @Transform(trimmed)
  @IsString()
  @MaxLength(60)
  q!: string;
}

/** Fields next to the uploaded file (or the pasted text) of `resolve-lines`. */
export class ResolveAdjustmentLinesDto {
  @ApiProperty({ description: 'Warehouse being adjusted: the stock checked is the one there' })
  @IsUUID()
  warehouseId!: string;

  @ApiPropertyOptional({ description: 'Pasted `code, quantity[, kind]` lines; omit it when a file is sent' })
  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  text?: string;
}

export class AdjustmentLineDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty({ enum: ADJUSTMENT_KINDS })
  @IsIn(ADJUSTMENT_KINDS)
  kind!: AdjustmentKind;

  /** Pieces to add or take out (at least 1), or the counted stock for `COUNT` (0 or more); the domain checks it per kind. */
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(ADJUSTMENT_LINE_QUANTITY_MAX)
  quantity!: number;

  /** Balance the user saw; a different locked balance answers `STOCK_CHANGED`. */
  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedBalance?: number;
}

/**
 * Body of a manual adjustment (HU-INV-22, IN-08). The reason and the lines are checked by the domain, not here, so a missing
 * reason answers `REASON_REQUIRED` and an empty list `ADJUSTMENT_EMPTY`, the codes the screen shows.
 */
export class CreateAdjustmentDto {
  @ApiProperty()
  @IsUUID()
  warehouseId!: string;

  @ApiPropertyOptional({ enum: ADJUSTMENT_REASONS })
  @IsOptional()
  @IsIn(ADJUSTMENT_REASONS)
  reason?: AdjustmentReason;

  @ApiPropertyOptional({ maxLength: ADJUSTMENT_NOTE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(ADJUSTMENT_NOTE_MAX)
  note?: string;

  @ApiProperty({ type: [AdjustmentLineDto], maxItems: ADJUSTMENT_LINES_MAX })
  @IsArray()
  @ArrayMaxSize(ADJUSTMENT_LINES_MAX)
  @ValidateNested({ each: true })
  @Type(() => AdjustmentLineDto)
  lines!: AdjustmentLineDto[];
}
