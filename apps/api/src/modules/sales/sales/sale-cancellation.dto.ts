import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CANCELLATION_COMMENT_MAX, CANCELLATION_REASONS, CANCELLATION_REPLY_MAX, type CancellationReason } from '@rodasoft/domain';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

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

/**
 * `POST /sales/sales/:id/cancellation-request/approve` and `/reject` (HU-VEN-15). The reply is optional here; rejecting
 * requires it, and the service says so with the domain's `validateCancellationDecision`.
 */
export class CancellationDecisionDto {
  @ApiPropertyOptional({ maxLength: CANCELLATION_REPLY_MAX })
  @IsOptional()
  @IsString()
  comment?: string;
}
