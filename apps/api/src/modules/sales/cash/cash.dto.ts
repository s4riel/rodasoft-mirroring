import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { OpenCashShiftInput } from '@rodasoft/domain';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ListCashRegistersQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class OpenCashShiftDto implements OpenCashShiftInput {
  @ApiProperty()
  @IsUUID()
  registerId!: string;

  @ApiProperty({ example: '500.00', description: 'Decimal string, never a JSON number' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  openingFloat!: string;
}
