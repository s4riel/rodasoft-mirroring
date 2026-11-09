import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import { QUOTE_MAX_LINES, QUOTE_MAX_QUANTITY, type CreateDispatchInput } from '@rodasoft/domain';

export class DispatchLineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orderItemId!: string;

  /** Zero is allowed: the screen sends every line, and a line at zero stays pending. */
  @ApiProperty({ minimum: 0, maximum: QUOTE_MAX_QUANTITY })
  @IsInt()
  @Min(0)
  @Max(QUOTE_MAX_QUANTITY)
  quantity!: number;
}

export class CreateDispatchDto implements CreateDispatchInput {
  @ApiProperty({ type: [DispatchLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(QUOTE_MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => DispatchLineDto)
  items!: DispatchLineDto[];
}
