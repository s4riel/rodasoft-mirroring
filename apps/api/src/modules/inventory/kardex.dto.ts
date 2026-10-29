import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { KARDEX_SEARCH_MAX, PRODUCT_PAGE_SIZE_MAX, STOCK_MOVEMENT_TYPES, type StockMovementType } from '@rodasoft/domain';

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Filters of the kardex of one product (HU-INV-24). Days are La Paz calendar days, `YYYY-MM-DD`. */
export class KardexQueryDto {
  @ApiPropertyOptional({ description: 'The product whose kardex is read; omitted: the ledger of every movement (then `type` and `q` apply)' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ enum: STOCK_MOVEMENT_TYPES, description: 'Ledger only: one movement type' })
  @IsOptional()
  @IsIn(STOCK_MOVEMENT_TYPES)
  type?: StockMovementType;

  @ApiPropertyOptional({ description: 'Ledger only: document number, product code or SKU contains this text' })
  @IsOptional()
  @IsString()
  @MaxLength(KARDEX_SEARCH_MAX)
  // Postgres text cannot hold a NUL byte: it is dropped instead of reaching the query
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.replaceAll(String.fromCharCode(0), '') : value))
  q?: string;

  @ApiPropertyOptional({ description: 'Only this warehouse; omitted: every warehouse the member may see' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ description: 'Only the warehouses of this branch (must be one the member operates)' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ example: '2026-10-01', description: 'First day; default: the first day of the current month' })
  @IsOptional()
  @Matches(DAY_PATTERN)
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31', description: 'Last day included; default: the last day of the current month' })
  @IsOptional()
  @Matches(DAY_PATTERN)
  to?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25, maximum: PRODUCT_PAGE_SIZE_MAX })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PRODUCT_PAGE_SIZE_MAX)
  pageSize?: number;
}

/** The export has no pages: it writes the whole range. */
export class KardexExportQueryDto extends OmitType(KardexQueryDto, ['page', 'pageSize'] as const) {}
