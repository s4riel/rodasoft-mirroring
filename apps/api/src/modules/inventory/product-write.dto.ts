import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ArrayMaxSize,
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
  countryId?: string | null;

  @ApiPropertyOptional({ description: 'Commercial name; built from the category and brand when omitted' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string | null;

  @ApiPropertyOptional({ example: '45.50' })
  @IsOptional()
  @Matches(DECIMAL_2)
  salePrice?: string | null;

  /** Only stored with inventory.costs.view; ignored otherwise. */
  @ApiPropertyOptional({ example: '30.0000' })
  @IsOptional()
  @Matches(DECIMAL_4)
  cost?: string | null;

  @ApiPropertyOptional({ example: 'UN' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  unit?: string;

  @ApiPropertyOptional({ description: 'Inner diameter d, mm' })
  @IsOptional()
  @Matches(MEASURE)
  innerDiameter?: string | null;

  @ApiPropertyOptional({ description: 'Outer diameter D, mm' })
  @IsOptional()
  @Matches(MEASURE)
  outerDiameter?: string | null;

  @ApiPropertyOptional({ description: 'Width B (T for tapered bearings), mm' })
  @IsOptional()
  @Matches(MEASURE)
  width?: string | null;

  @ApiPropertyOptional({ description: 'Weight, kg' })
  @IsOptional()
  @Matches(MEASURE)
  weight?: string | null;

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
  tariffCode?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  supplierName?: string | null;

  @ApiPropertyOptional({ example: '2026-10-22' })
  @IsOptional()
  @Matches(DATE)
  entryDate?: string | null;

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

  /** Storage keys of the photos, from `POST /inventory/uploads` (at most five, IN-03 step 4). */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(500, { each: true }) // a Cloudinary URL is longer than a disk key
  photos?: string[];

  /** Storage key of the datasheet PDF, from `POST /inventory/uploads`. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  datasheetKey?: string | null;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  minStock?: number | null;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxStock?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  location?: string | null;
}

/**
 * Body of `PATCH /inventory/products/:id` (HU-INV-07). It reuses the wizard shape; `status`, `branchId` and `initialStock`
 * stay declared so the service can refuse them with `FIELD_NOT_EDITABLE` (an unknown field would be a generic 400).
 */
export class ProductUpdateDto extends ProductWriteDto {
  /** The `updatedAt` the form was loaded with; another edit in between makes the save a 409. */
  @ApiProperty({ example: '2026-10-22T10:00:00.000Z' })
  @IsISO8601()
  expectedUpdatedAt!: string;

  /** Branch whose main warehouse holds the thresholds being edited. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  thresholdBranchId?: string;
}

/** Fields of `POST /inventory/uploads` next to the file. */
export class UploadFieldsDto {
  @ApiProperty({ enum: ['photo', 'datasheet'] })
  @IsIn(['photo', 'datasheet'])
  kind!: 'photo' | 'datasheet';

  /** Manufacturer code of the product: the file is named `<code>_v<n>`. */
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  code!: string;
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

/** Measures and fields typed so far, to look for equivalents of a product that is not saved yet. */
export class EquivalenceCandidatesDto {
  @ApiProperty()
  @IsUUID()
  categoryId!: string;

  @ApiProperty({ description: 'Inner diameter d, mm' })
  @Matches(MEASURE)
  innerDiameter!: string;

  @ApiProperty({ description: 'Outer diameter D, mm' })
  @Matches(MEASURE)
  outerDiameter!: string;

  @ApiProperty({ description: 'Width B, mm' })
  @Matches(MEASURE)
  width!: string;

  @ApiPropertyOptional({ type: Object, description: 'Technical fields typed so far (seal, clearance…) to tell exact from different' })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;
}

export class LinkEquivalenceDto {
  @ApiProperty()
  @IsUUID()
  productAId!: string;

  @ApiProperty()
  @IsUUID()
  productBId!: string;

  /** Classifies the link as a substitute instead of an equivalent (IN-15c, "Sustituto"). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  substitute?: boolean;

  /** Observed differences (IN-15c); blank counts as none. */
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
