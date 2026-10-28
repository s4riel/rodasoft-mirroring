import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  normalizeWarehouseCode,
  WAREHOUSE_CODE_PATTERN,
  WAREHOUSE_LOCATION_NOTE_MAX,
  WAREHOUSE_NAME_MAX,
  WAREHOUSE_PAGE_SIZE_MAX,
  type WarehouseCreateInput,
  type WarehouseStatus,
  type WarehouseUpdateInput,
} from '@rodasoft/domain';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

const WAREHOUSE_STATUSES: WarehouseStatus[] = ['ACTIVE', 'INACTIVE'];

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const normalizedCode = ({ value }: { value: unknown }) => (typeof value === 'string' ? normalizeWarehouseCode(value) : value);
/** An empty note is stored as no note. */
const emptyToNull = ({ value }: { value: unknown }) => (typeof value === 'string' && value.trim() === '' ? null : trimmed({ value }));

export class ListWarehousesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ enum: WAREHOUSE_STATUSES })
  @IsOptional()
  @IsIn(WAREHOUSE_STATUSES)
  status?: WarehouseStatus;

  @ApiPropertyOptional({ description: 'Matches the code or the name' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: WAREHOUSE_PAGE_SIZE_MAX })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(WAREHOUSE_PAGE_SIZE_MAX)
  pageSize?: number;
}

export class CreateWarehouseDto implements WarehouseCreateInput {
  @ApiProperty({ example: 'HK-02' })
  @Transform(normalizedCode)
  @IsString()
  @Matches(WAREHOUSE_CODE_PATTERN)
  code!: string;

  @ApiProperty({ maxLength: WAREHOUSE_NAME_MAX })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(WAREHOUSE_NAME_MAX)
  name!: string;

  @ApiProperty()
  @IsUUID()
  branchId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isMain?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  visibleInStore?: boolean;

  @ApiPropertyOptional({ maxLength: WAREHOUSE_LOCATION_NOTE_MAX, nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((o: CreateWarehouseDto) => o.locationNote !== null)
  @IsString()
  @MaxLength(WAREHOUSE_LOCATION_NOTE_MAX)
  locationNote?: string | null;
}

export class UpdateWarehouseDto implements WarehouseUpdateInput {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(normalizedCode)
  @IsString()
  @Matches(WAREHOUSE_CODE_PATTERN)
  code?: string;

  @ApiPropertyOptional({ maxLength: WAREHOUSE_NAME_MAX })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(WAREHOUSE_NAME_MAX)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isMain?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  visibleInStore?: boolean;

  @ApiPropertyOptional({ maxLength: WAREHOUSE_LOCATION_NOTE_MAX, nullable: true, type: String })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((o: UpdateWarehouseDto) => o.locationNote !== null)
  @IsString()
  @MaxLength(WAREHOUSE_LOCATION_NOTE_MAX)
  locationNote?: string | null;

  @ApiPropertyOptional({ enum: WAREHOUSE_STATUSES })
  @IsOptional()
  @IsIn(WAREHOUSE_STATUSES)
  status?: WarehouseStatus;

  /** `updatedAt` the form loaded; a different stored value answers `WAREHOUSE_MODIFIED`. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  expectedUpdatedAt?: string;
}
