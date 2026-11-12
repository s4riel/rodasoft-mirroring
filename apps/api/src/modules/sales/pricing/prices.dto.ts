import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PRICE_PAGE_SIZE_MAX,
  PRICE_REASON_MAX,
  PRICED_FILTERS,
  type EditPriceInput,
  type PricedFilter,
  type PriceListQuery,
} from '@rodasoft/domain';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ListPricesQueryDto implements PriceListQuery {
  @ApiPropertyOptional({ description: 'Code, name, brand or measurement' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  brandId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: PRICED_FILTERS })
  @IsOptional()
  @IsIn(PRICED_FILTERS)
  priced?: PricedFilter;

  @ApiPropertyOptional({ description: 'Branch whose stock the list shows; the first one the caller operates by default' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: PRICE_PAGE_SIZE_MAX })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PRICE_PAGE_SIZE_MAX)
  pageSize?: number;
}

/** The prices are plain strings here: the domain rule answers a bad amount with `INVALID_PRICE`. */
export class EditPriceDto implements EditPriceInput {
  @ApiProperty({ example: '255.00', description: 'Decimal string, never a JSON number' })
  @Transform(trimmed)
  @IsString()
  @MaxLength(20)
  newPrice!: string;

  @ApiProperty({ example: '245.00', description: 'The price the editor saw' })
  @Transform(trimmed)
  @IsString()
  @MaxLength(20)
  expectedPrice!: string;

  @ApiPropertyOptional({ maxLength: PRICE_REASON_MAX })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(PRICE_REASON_MAX)
  reason?: string;
}
