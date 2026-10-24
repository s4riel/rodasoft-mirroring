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
import {
  type DuplicateProductRequest,
  type EquivalenceKind,
  PRODUCT_PAGE_SIZE_MAX,
  type ProductCopyPart,
} from '@rodasoft/domain';

/** Parts the API accepts for a copy. */
export const DUPLICATE_COPY_PARTS = ['dimensions', 'specifications', 'price', 'media', 'equivalences'] as const;

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

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE', 'DRAFT'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'DRAFT'])
  status?: 'ACTIVE' | 'INACTIVE' | 'DRAFT';

  @ApiPropertyOptional({
    enum: ['true'],
    description: 'Only products that can be sold (ACTIVE): the contract for the POS, quotes and the web store',
  })
  @IsOptional()
  @IsIn(['true'])
  sellable?: 'true';

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

export class CompareEquivalentsQueryDto {
  @ApiProperty({ description: 'Product ids separated by commas, 2 to 4; the first one is the reference', example: 'id1,id2,id3' })
  @IsString()
  @IsNotEmpty()
  ids!: string;
}

export class ListEquivalencesQueryDto {
  @ApiPropertyOptional({ description: 'Links where either side is of this brand' })
  @IsOptional()
  @IsUUID()
  brandId?: string;

  @ApiPropertyOptional({ description: 'Links where either side is of this category (a root also matches its subcategories)' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: ['EXACT', 'WITH_DIFFERENCES', 'INCOMPATIBLE'] })
  @IsOptional()
  @IsIn(['EXACT', 'WITH_DIFFERENCES', 'INCOMPATIBLE'])
  kind?: EquivalenceKind;

  @ApiPropertyOptional({ description: 'Manufacturer code of either side' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

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
