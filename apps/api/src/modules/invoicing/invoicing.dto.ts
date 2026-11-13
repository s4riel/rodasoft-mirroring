import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { INVOICE_BULK_DOWNLOAD_MAX, INVOICE_BULK_ISSUE_MAX, INVOICE_DELIVERY_CHANNELS, type InvoiceDeliveryChannel, INVOICE_PAGE_SIZE_MAX, INVOICE_STATUSES, type InvoiceStatus } from '@rodasoft/domain';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ListInvoicesQueryDto {
  @ApiPropertyOptional({ description: 'Matches the invoice or sale number, or the customer name or document' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(60)
  q?: string;

  @ApiPropertyOptional({ enum: INVOICE_STATUSES })
  @IsOptional()
  @IsIn(INVOICE_STATUSES)
  status?: InvoiceStatus;

  @ApiPropertyOptional({ description: 'Created on or after this La Paz day (YYYY-MM-DD)' })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({ description: 'Created on or before this La Paz day (YYYY-MM-DD)' })
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: INVOICE_PAGE_SIZE_MAX })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(INVOICE_PAGE_SIZE_MAX)
  pageSize?: number;
}

export class IssueInvoicesDto {
  @ApiProperty({ type: [String], maxItems: INVOICE_BULK_ISSUE_MAX })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(INVOICE_BULK_ISSUE_MAX)
  @IsUUID('all', { each: true })
  ids!: string[];
}

export class DownloadInvoicesDto {
  @ApiProperty({ type: [String], maxItems: INVOICE_BULK_DOWNLOAD_MAX })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(INVOICE_BULK_DOWNLOAD_MAX)
  @IsUUID('all', { each: true })
  ids!: string[];

  @ApiProperty({ enum: ['PDF', 'XML'] })
  @IsIn(['PDF', 'XML'])
  format!: 'PDF' | 'XML';
}

export class DeliverInvoiceDto {
  @ApiProperty({ enum: INVOICE_DELIVERY_CHANNELS })
  @IsIn(INVOICE_DELIVERY_CHANNELS)
  channel!: InvoiceDeliveryChannel;

  @ApiProperty({ description: 'An e-mail address, or a Bolivian mobile number for WhatsApp' })
  @Transform(trimmed)
  @IsString()
  @MaxLength(120)
  recipient!: string;
}

export class InvoiceCancellationRequestDto {
  @ApiProperty({ description: 'A code of the SIN cancellation reasons (1 to 4)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  reasonCode!: number;

  @ApiProperty()
  @Transform(trimmed)
  @IsString()
  @MaxLength(600)
  comment!: string;
}

export class NitExceptionRequestDto {
  @ApiProperty({ description: 'Why the invoice must go with a NIT the SIN does not recognise' })
  @Transform(trimmed)
  @IsString()
  @MaxLength(600)
  reason!: string;
}

export class NitExceptionDecisionDto {
  @ApiPropertyOptional({ description: 'The reply for who asked; required to reject' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class UpdateInvoiceCustomerDto {
  @ApiProperty()
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ description: 'SIN identity document type (1 CI, 2 CEX, 3 PAS, 4 OD, 5 NIT)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  documentType!: number;

  @ApiProperty()
  @Transform(trimmed)
  @IsString()
  @MaxLength(30)
  documentNumber!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(2)
  complement?: string;
}
