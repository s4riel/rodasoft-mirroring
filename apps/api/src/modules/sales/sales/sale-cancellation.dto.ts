import { ApiProperty } from '@nestjs/swagger';
import { CANCELLATION_COMMENT_MAX, CANCELLATION_REASONS, type CancellationReason } from '@rodasoft/domain';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** `POST /sales/sales/:id/cancellation-request` */
export class CancellationRequestDto {
  @ApiProperty({ enum: CANCELLATION_REASONS })
  @IsIn(CANCELLATION_REASONS)
  reason!: CancellationReason;

  @ApiProperty({ maxLength: CANCELLATION_COMMENT_MAX })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(CANCELLATION_COMMENT_MAX)
  comment!: string;
}
