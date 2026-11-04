import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { AddPosCheckoutItemInput, PosProductSearchQuery, UpdatePosCheckoutItemInput } from '@rodasoft/domain';
import { Transform } from 'class-transformer';
import { IsDefined, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class PosProductSearchQueryDto implements PosProductSearchQuery {
  @ApiPropertyOptional({ description: 'Code, SKU, name, brand or measurement ("25x52x15")' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : ''))
  @IsString()
  @MaxLength(100)
  q = '';

  @ApiPropertyOptional({ description: 'A root category: matches its products and its subcategories’ products' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

/** `quantity` is only required here; the service checks it is a whole number ≥ 1 and answers `INVALID_QUANTITY`. */
export class AddPosCheckoutItemDto implements AddPosCheckoutItemInput {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty({ example: 1 })
  @IsDefined()
  quantity!: number;
}

export class UpdatePosCheckoutItemDto implements UpdatePosCheckoutItemInput {
  @ApiProperty({ example: 2 })
  @IsDefined()
  quantity!: number;
}
