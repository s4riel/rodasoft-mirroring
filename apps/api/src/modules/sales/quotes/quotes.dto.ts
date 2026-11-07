import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ORDER_CANCEL_REASON_MAX,
  QUOTE_MAX_LINES,
  QUOTE_MESSAGE_MAX,
  QUOTE_SEND_CHANNELS,
  QUOTE_MAX_QUANTITY,
  SALES_DOCUMENT_PAGE_SIZE_MAX,
  type QuoteSendChannel,
  type QuoteStatus,
  type SalesOrderStatus,
} from '@rodasoft/domain';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

const QUOTE_STATUSES: QuoteStatus[] = ['DRAFT', 'SENT', 'ACCEPTED', 'EXPIRED', 'REJECTED'];
const ORDER_STATUSES: SalesOrderStatus[] = ['OPEN', 'PARTIALLY_DISPATCHED', 'DISPATCHED', 'CANCELLED'];

class PagingDto {
  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: SALES_DOCUMENT_PAGE_SIZE_MAX })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SALES_DOCUMENT_PAGE_SIZE_MAX)
  pageSize?: number;
}

export class ListQuotesQueryDto extends PagingDto {
  @ApiPropertyOptional({ enum: QUOTE_STATUSES })
  @IsOptional()
  @IsIn(QUOTE_STATUSES)
  status?: QuoteStatus;

  @ApiPropertyOptional({ description: 'Matches the quote number or the customer name or document' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(60)
  q?: string;
}

export class ListSalesOrdersQueryDto extends PagingDto {
  @ApiPropertyOptional({ enum: ORDER_STATUSES })
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: SalesOrderStatus;

  @ApiPropertyOptional({ description: 'Matches the order or quote number or the customer name or document' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(60)
  q?: string;
}

export class QuoteProductSearchQueryDto {
  @ApiProperty()
  @Transform(trimmed)
  @IsString()
  @MaxLength(60)
  q!: string;

  @ApiProperty()
  @IsUUID()
  warehouseId!: string;
}

export class QuoteCustomerSearchQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(60)
  q?: string;
}

export class QuoteLineDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(QUOTE_MAX_QUANTITY)
  quantity!: number;
}

export class CreateQuoteDto {
  @ApiProperty()
  @IsUUID()
  customerId!: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD; today plus sales.quoteValidityDays when omitted' })
  @IsOptional()
  @IsISO8601({ strict: true })
  validUntil?: string;

  @ApiProperty({ type: [QuoteLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(QUOTE_MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => QuoteLineDto)
  lines!: QuoteLineDto[];
}

export class ConvertQuoteDto {
  @ApiProperty()
  @IsUUID()
  warehouseId!: string;
}

export class CancelSalesOrderDto {
  @ApiProperty({ maxLength: ORDER_CANCEL_REASON_MAX })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(ORDER_CANCEL_REASON_MAX)
  reason!: string;
}

export class SendQuoteDto {
  @ApiProperty({ enum: QUOTE_SEND_CHANNELS })
  @IsIn([...QUOTE_SEND_CHANNELS])
  channel!: QuoteSendChannel;

  @ApiPropertyOptional({ description: 'E-mail address or WhatsApp number; not used for PDF' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(120)
  to?: string;

  @ApiPropertyOptional({ maxLength: QUOTE_MESSAGE_MAX })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(QUOTE_MESSAGE_MAX)
  message?: string;
}

export class RenewQuoteDto {
  @ApiPropertyOptional({ description: 'YYYY-MM-DD; today plus sales.quoteValidityDays when omitted' })
  @IsOptional()
  @IsISO8601({ strict: true })
  validUntil?: string;
}
