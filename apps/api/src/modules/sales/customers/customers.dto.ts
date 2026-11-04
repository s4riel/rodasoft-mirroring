import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { CreatePosCustomerInput, CustomerListQuery, SaveCustomerInput, SetPosCustomerInput, UpdateCustomerInput } from '@rodasoft/domain';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** An empty optional text is "none". */
const blankToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

/** Identity document types of the SIN catalog (`IdentityDocumentType`): CI, CEX, PAS, OD, NIT. */
const DOCUMENT_TYPES = [1, 2, 3, 4, 5];
const DECIMAL = /^\d{1,12}(\.\d{1,2})?$/;

export class PosCustomerSearchQueryDto {
  @ApiPropertyOptional({ description: 'Name or document number' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : ''))
  @IsString()
  @MaxLength(100)
  q = '';
}

export class CreatePosCustomerDto implements CreatePosCustomerInput {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @ApiProperty({ example: 5, description: '1 CI, 2 CEX, 3 PAS, 4 OD, 5 NIT' })
  @IsInt()
  @IsIn(DOCUMENT_TYPES)
  documentType!: number;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  documentNumber!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(5)
  complement?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(blankToNull)
  @IsEmail()
  @MaxLength(150)
  email?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(30)
  phone?: string | null;
}

export class SaveCustomerDto extends CreatePosCustomerDto implements SaveCustomerInput {
  @ApiProperty()
  @IsBoolean()
  creditEnabled!: boolean;

  @ApiProperty({ enum: ['NONE', 'PERCENT', 'AMOUNT'] })
  @IsIn(['NONE', 'PERCENT', 'AMOUNT'])
  discountType!: 'NONE' | 'PERCENT' | 'AMOUNT';

  @ApiProperty({ example: '10.00', description: 'Decimal string, never a JSON number; "0" with no discount' })
  @Transform(trim)
  @Matches(DECIMAL)
  discountValue!: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

/** Every field optional; the service merges it with the stored customer and validates the result. */
export class UpdateCustomerDto implements UpdateCustomerInput {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @IsIn(DOCUMENT_TYPES)
  documentType?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  documentNumber?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(5)
  complement?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(blankToNull)
  @IsEmail()
  @MaxLength(150)
  email?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  creditEnabled?: boolean;

  @ApiPropertyOptional({ enum: ['NONE', 'PERCENT', 'AMOUNT'] })
  @IsOptional()
  @IsIn(['NONE', 'PERCENT', 'AMOUNT'])
  discountType?: 'NONE' | 'PERCENT' | 'AMOUNT';

  @ApiPropertyOptional({ example: '10.00' })
  @IsOptional()
  @Transform(trim)
  @Matches(DECIMAL)
  discountValue?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

export class CustomerListQueryDto implements CustomerListQuery {
  @ApiPropertyOptional({ description: 'Name or document number' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE', 'ALL'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'ALL'])
  status?: 'ACTIVE' | 'INACTIVE' | 'ALL';

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class SetPosCustomerDto implements SetPosCustomerInput {
  @ApiProperty({ nullable: true, description: 'The customer, or null to invoice a final consumer' })
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  customerId!: string | null;
}
