import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { type DuplicateProductRequest, PRODUCT_PAGE_SIZE_MAX, type ProductCopyPart } from '@rodasoft/domain';

/** Parts the API accepts for a copy; `equivalences` is not supported until HU-INV-13. */
export const DUPLICATE_COPY_PARTS = ['dimensions', 'specifications', 'price', 'media'] as const;

export class DuplicateProductDto implements DuplicateProductRequest {
  @ApiProperty({ description: 'Manufacturer code of the copy; unique per brand' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  @Matches(/\S/)
  manufacturerCode!: string;

  @ApiProperty()
  @IsUUID()
  brandId!: string;

  @ApiProperty({ nullable: true, type: String, description: 'Industry (country of origin) of the copy' })
  @ValidateIf((o: DuplicateProductDto) => o.countryId !== null)
  @IsUUID()
  countryId!: string | null;

  @ApiProperty({ enum: DUPLICATE_COPY_PARTS, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsIn(DUPLICATE_COPY_PARTS, { each: true })
  copy!: ProductCopyPart[];
}

export class ListProductsQueryDto {
  @ApiPropertyOptional({ description: 'Industry (country of origin) of the brand' })
  @IsOptional()
  @IsUUID()
  countryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  subcategoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  brandId?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @ApiPropertyOptional({ description: 'Code, SKU, name, brand or measurement (25x52x15)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ description: 'Branch whose stock is shown in branchStock (not a filter)' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

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

export class ListEquivalentsQueryDto {
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

export class ListMovementsQueryDto {
  @ApiPropertyOptional({ description: 'Warehouse branch whose movements are listed (must be one the member operates)' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  /** Window of the summary KPIs; the design shows 30 days. */
  @ApiPropertyOptional({ default: 30, maximum: 365 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;

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
