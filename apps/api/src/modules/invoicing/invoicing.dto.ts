import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CREDIT_NOTE_STATUSES, HOMOLOGATION_STATUSES, type HomologationStatus, type CreditNoteStatus, INVOICE_BULK_DOWNLOAD_MAX, INVOICE_BULK_ISSUE_MAX, INVOICE_DELIVERY_CHANNELS, type InvoiceDeliveryChannel, INVOICE_PAGE_SIZE_MAX, INVOICE_STATUSES, type InvoiceStatus, VAT_BOOK_EXPORT_FORMATS, VAT_BOOKS, VAT_PERIOD_REOPEN_REASON_MAX, VAT_PERIOD_REOPEN_REASON_MIN, type VatBook, type VatBookExportFormat } from '@rodasoft/domain';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

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

/** The filters of the credit note list (HU-FAC-11): the same as the invoice list, with the statuses of a note. */
export class ListCreditNotesQueryDto {
  @ApiPropertyOptional({ description: 'Matches the note, invoice or return number, or the customer name or document' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(60)
  q?: string;

  @ApiPropertyOptional({ enum: CREDIT_NOTE_STATUSES })
  @IsOptional()
  @IsIn(CREDIT_NOTE_STATUSES)
  status?: CreditNoteStatus;

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

export class CreditNoteItemDto {
  @ApiProperty({ description: 'The invoiced line (sale item) the note credits' })
  @IsUUID()
  saleItemId!: string;

  @ApiProperty({ description: 'Pieces credited; 0 for a price adjustment', minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantity!: number;

  @ApiProperty({ description: 'Amount credited, a decimal string with up to 2 places', example: '40.00' })
  @IsString()
  @Matches(/^\d{1,12}(\.\d{1,2})?$/)
  amount!: string;
}

export class CreateCreditNoteDto {
  @ApiProperty({ description: 'A code of the credit note reasons' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  reasonCode!: number;

  @ApiProperty({ type: [CreditNoteItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreditNoteItemDto)
  items!: CreditNoteItemDto[];
}

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export class VatBookQueryDto {
  @ApiProperty({ description: 'A La Paz month', example: '2026-11' })
  @Matches(PERIOD)
  period!: string;

  @ApiPropertyOptional({ description: 'Sales book only: the invoices of one branch' })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class VatBookExportQueryDto {
  @ApiProperty({ enum: VAT_BOOKS })
  @IsIn(VAT_BOOKS)
  book!: VatBook;

  @ApiProperty({ description: 'A La Paz month', example: '2026-11' })
  @Matches(PERIOD)
  period!: string;

  @ApiProperty({ enum: VAT_BOOK_EXPORT_FORMATS })
  @IsIn(VAT_BOOK_EXPORT_FORMATS)
  format!: VatBookExportFormat;
}

export class ReopenVatPeriodDto {
  @ApiProperty({ description: 'Why the closed period is opened again', minLength: VAT_PERIOD_REOPEN_REASON_MIN, maxLength: VAT_PERIOD_REOPEN_REASON_MAX })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(VAT_PERIOD_REOPEN_REASON_MAX)
  reason!: string;
}

export class VerifyPurchaseNitDto {
  @ApiPropertyOptional({ description: 'A corrected NIT of the supplier; the stored one is verified when left out' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(20)
  supplierNit?: string;
}

// ── Fiscal configuration (HU-FAC-22…27) ──

export class SaveSignatureDto {
  @ApiProperty({ description: 'The password of the .p12 file' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}

export class SaveCredentialsDto {
  @ApiProperty({ description: 'System code the SIN gave the company' })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  systemCode!: string;

  @ApiProperty({ description: 'The SIAT delegated token' })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  token!: string;

  @ApiProperty({ description: 'When the token expires (ISO 8601)' })
  @IsISO8601({ strict: true })
  tokenExpiresAt!: string;
}

export class SaveActivityDto {
  @ApiProperty({ description: 'A code of the synced activity catalogue' })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  mainActivityCode!: string;

  @ApiPropertyOptional({ description: 'A code of the synced product catalogue, used for a product that has none' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(20)
  defaultProductCode?: string;
}

export class EnableProductionDto {
  @ApiProperty({ description: 'The confirmation word the person typed' })
  @IsString()
  @MaxLength(50)
  confirmation!: string;
}

export class CreatePointOfSaleDto {
  @ApiProperty()
  @IsUUID()
  branchId!: string;

  @ApiProperty()
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ description: 'A code of the SIN point-of-sale types' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  typeCode!: number;

  @ApiProperty({ description: 'Warehouse the new cash register sells from' })
  @IsUUID()
  warehouseId!: string;
}

export class CatalogEntriesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(60)
  q?: string;

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

export class HomologationQueryDto extends CatalogEntriesQueryDto {
  @ApiPropertyOptional({ enum: HOMOLOGATION_STATUSES })
  @IsOptional()
  @IsIn(HOMOLOGATION_STATUSES)
  status?: HomologationStatus;
}

export class HomologateProductDto {
  @ApiProperty({ description: 'A code of the synced product catalogue' })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  sinProductCode!: string;

  @ApiPropertyOptional({ description: 'A code of the synced unit-of-measure catalogue' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sinUnitCode?: number;
}
