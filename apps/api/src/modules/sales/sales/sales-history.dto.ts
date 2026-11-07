import { ApiPropertyOptional } from '@nestjs/swagger';
import { SALE_PAGE_SIZE_MAX, SALE_PAYMENT_METHODS, SALE_STATUSES, type PaymentMethod, type SaleStatus } from '@rodasoft/domain';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ListSalesQueryDto {
  @ApiPropertyOptional({ enum: SALE_STATUSES })
  @IsOptional()
  @IsIn(SALE_STATUSES)
  status?: SaleStatus;

  @ApiPropertyOptional({ enum: SALE_PAYMENT_METHODS })
  @IsOptional()
  @IsIn(SALE_PAYMENT_METHODS)
  method?: PaymentMethod;

  @ApiPropertyOptional({ description: 'Sold on or after this La Paz day (YYYY-MM-DD)' })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({ description: 'Sold on or before this La Paz day (YYYY-MM-DD)' })
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  @ApiPropertyOptional({ description: 'Matches the sale number or the customer name or document' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(60)
  q?: string;

  @ApiPropertyOptional({ description: 'Only for who may see every sale; ignored otherwise' })
  @IsOptional()
  @IsUUID()
  cashierId?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: SALE_PAGE_SIZE_MAX })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SALE_PAGE_SIZE_MAX)
  pageSize?: number;
}
