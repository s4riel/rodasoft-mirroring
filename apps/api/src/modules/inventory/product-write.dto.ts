import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const DECIMAL_2 = /^\d{1,11}(\.\d{1,2})?$/;
const DECIMAL_4 = /^\d{1,10}(\.\d{1,4})?$/;
const MEASURE = /^\d{1,7}(\.\d{1,3})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Body of the product creation wizard (HU-INV-06). The same shape is used to create a product (POST, status ACTIVE or
 * DRAFT) and to save a draft (PATCH). Every field is optional at the DTO level: the domain rules decide what a draft or
 * a final product must have, so the errors come back with the field and code the wizard shows.
 */
export class ProductWriteDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'DRAFT'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'DRAFT'])
  status?: 'ACTIVE' | 'DRAFT';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  manufacturerCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  brandId?: string;

  @ApiPropertyOptional({ description: 'Leaf category (a subcategory when there is one)' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Industry (country of origin); the brand country when omitted' })
  @IsOptional()
  @IsUUID()
  countryId?: string;

  @ApiPropertyOptional({ description: 'Commercial name; built from the category and brand when omitted' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ example: '45.50' })
  @IsOptional()
  @Matches(DECIMAL_2)
  salePrice?: string;

  /** Only stored with inventory.costs.view; ignored otherwise. */
  @ApiPropertyOptional({ example: '30.0000' })
  @IsOptional()
  @Matches(DECIMAL_4)
  cost?: string;

  @ApiPropertyOptional({ example: 'UN' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  unit?: string;

  @ApiPropertyOptional({ description: 'Inner diameter d, mm' })
  @IsOptional()
  @Matches(MEASURE)
  innerDiameter?: string;

  @ApiPropertyOptional({ description: 'Outer diameter D, mm' })
  @IsOptional()
  @Matches(MEASURE)
  outerDiameter?: string;

  @ApiPropertyOptional({ description: 'Width B (T for tapered bearings), mm' })
  @IsOptional()
  @Matches(MEASURE)
  width?: string;

  @ApiPropertyOptional({ description: 'Weight, kg' })
  @IsOptional()
  @Matches(MEASURE)
  weight?: string;

  @ApiPropertyOptional({ type: Object, description: 'Technical fields, keyed by attribute definition key' })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  sectors?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  tariffCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  supplierName?: string;

  @ApiPropertyOptional({ example: '2026-10-22' })
  @IsOptional()
  @Matches(DATE)
  entryDate?: string;

  /** Branch that receives the initial stock; its main warehouse gets the stock and the thresholds. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  initialStock?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  minStock?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxStock?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  location?: string;
}

/** Fields of `POST /inventory/uploads` next to the file. */
export class UploadFieldsDto {
  @ApiProperty({ enum: ['photo', 'datasheet'] })
  @IsIn(['photo', 'datasheet'])
  kind!: 'photo' | 'datasheet';
}

export class CodeAvailabilityQueryDto {
  @ApiProperty()
  @IsUUID()
  brandId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  code!: string;
}

export class LinkEquivalenceDto {
  @ApiProperty()
  @IsUUID()
  productAId!: string;

  @ApiProperty()
  @IsUUID()
  productBId!: string;
}
