import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ADJUSTMENT_KINDS, ADJUSTMENT_NOTE_MAX, ADJUSTMENT_REASONS, type AdjustmentKind, type AdjustmentReason } from '@rodasoft/domain';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

/**
 * Body of the quick stock adjustment (HU-INV-16, IN-17). The reason is optional here on purpose: the domain rule
 * answers a missing one with `REASON_REQUIRED`, the code the modal shows, instead of a generic validation error.
 */
export class QuickAdjustmentDto {
  @ApiProperty()
  @IsUUID()
  warehouseId!: string;

  @ApiProperty({ enum: ADJUSTMENT_KINDS })
  @IsIn(ADJUSTMENT_KINDS)
  kind!: AdjustmentKind;

  /** Pieces to add or take out (at least 1), or the counted stock for `COUNT` (0 or more); the service checks it per kind. */
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  quantity!: number;

  @ApiPropertyOptional({ enum: ADJUSTMENT_REASONS })
  @IsOptional()
  @IsIn(ADJUSTMENT_REASONS)
  reason?: AdjustmentReason;

  @ApiPropertyOptional({ maxLength: ADJUSTMENT_NOTE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(ADJUSTMENT_NOTE_MAX)
  note?: string;

  /** Balance the user saw; a different locked balance answers `STOCK_CHANGED`. */
  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedBalance?: number;
}
