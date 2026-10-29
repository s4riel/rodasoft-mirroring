import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  TRANSFER_LINE_QUANTITY_MAX,
  TRANSFER_NOTE_MAX,
  TRANSFER_PAGE_SIZE_MAX,
  type TransferCloseInput,
  type TransferReceiptInput,
  type TransferSaveInput,
  type TransferStatus,
} from '@rodasoft/domain';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';

const TRANSFER_STATUSES: TransferStatus[] = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'IN_TRANSIT',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'REJECTED',
  'CANCELLED',
];

/** Hard ceiling of the lines array, so a request cannot be huge before the company's own `transfers.maxLines` applies. */
const LINES_CEILING = 5000;

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** An empty note is stored as no note. */
const emptyToNull = ({ value }: { value: unknown }) => (typeof value === 'string' && value.trim() === '' ? null : trimmed({ value }));

export class ListTransfersQueryDto {
  @ApiPropertyOptional({ enum: TRANSFER_STATUSES })
  @IsOptional()
  @IsIn(TRANSFER_STATUSES)
  status?: TransferStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  originWarehouseId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  destinationWarehouseId?: string;

  @ApiPropertyOptional({ description: 'Created on or after this day (ISO date)' })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({ description: 'Created on or before this day (ISO date)' })
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  @ApiPropertyOptional({ description: 'Matches the transfer number or the name of the origin or destination branch' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(40)
  q?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: TRANSFER_PAGE_SIZE_MAX })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TRANSFER_PAGE_SIZE_MAX)
  pageSize?: number;
}

export class ProductSearchQueryDto {
  @ApiProperty({ description: 'Origin warehouse: the stock shown is the one there' })
  @IsUUID()
  warehouseId!: string;

  @ApiProperty({ description: 'Code, brand, name or measurement' })
  @Transform(trimmed)
  @IsString()
  @MaxLength(80)
  q!: string;
}

export class TransferLineDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty({ minimum: 1, maximum: TRANSFER_LINE_QUANTITY_MAX })
  @IsInt()
  @Min(1)
  @Max(TRANSFER_LINE_QUANTITY_MAX)
  quantity!: number;
}

export class SaveTransferDto implements TransferSaveInput {
  @ApiProperty()
  @IsUUID()
  originWarehouseId!: string;

  @ApiProperty()
  @IsUUID()
  destinationWarehouseId!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: TRANSFER_NOTE_MAX })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(TRANSFER_NOTE_MAX)
  note?: string | null;

  @ApiProperty({ type: [TransferLineDto] })
  @IsArray()
  @ArrayMaxSize(LINES_CEILING)
  @ValidateNested({ each: true })
  @Type(() => TransferLineDto)
  lines!: TransferLineDto[];

  @ApiPropertyOptional({ description: 'Required when updating: the `updatedAt` the client read' })
  @IsOptional()
  @IsISO8601({ strict: true })
  expectedUpdatedAt?: string;
}

export class SendTransferDto {
  @ApiPropertyOptional({ description: 'The `updatedAt` the client read; the send is refused if the draft changed since' })
  @IsOptional()
  @IsISO8601({ strict: true })
  expectedUpdatedAt?: string;
}

/** Fields next to the uploaded file (or the pasted text) of `resolve-lines`. */
export class ResolveLinesDto {
  @ApiProperty({ description: 'Origin warehouse: the stock checked is the one there' })
  @IsUUID()
  warehouseId!: string;

  @ApiPropertyOptional({ description: 'Pasted `code, quantity` lines; omit it when a file is sent' })
  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  text?: string;
}

/** The pieces counted for one product: in a receiving session, the pieces that arrived now; at close, the surplus. */
export class ReceiptLineDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty({ minimum: 0, maximum: TRANSFER_LINE_QUANTITY_MAX })
  @IsInt()
  @Min(0)
  @Max(TRANSFER_LINE_QUANTITY_MAX)
  quantity!: number;
}

export class ReceiveTransferDto implements TransferReceiptInput {
  @ApiProperty({ type: [ReceiptLineDto], description: 'Pieces received now, per product; a session without pieces is refused' })
  @IsArray()
  @ArrayMaxSize(LINES_CEILING)
  @ValidateNested({ each: true })
  @Type(() => ReceiptLineDto)
  lines!: ReceiptLineDto[];

  @ApiPropertyOptional({ nullable: true, maxLength: TRANSFER_NOTE_MAX })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(TRANSFER_NOTE_MAX)
  note?: string | null;

  @ApiProperty({ description: 'The `updatedAt` the client read; the session is refused if the transfer changed since' })
  @IsISO8601({ strict: true })
  expectedUpdatedAt!: string;
}

export class CloseTransferDto implements TransferCloseInput {
  @ApiPropertyOptional({ type: [ReceiptLineDto], description: 'Last count, applied as one more session before closing' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(LINES_CEILING)
  @ValidateNested({ each: true })
  @Type(() => ReceiptLineDto)
  lines?: ReceiptLineDto[];

  @ApiProperty({ type: [ReceiptLineDto], description: 'Pieces beyond what was sent, per product; only on lines received in full' })
  @IsArray()
  @ArrayMaxSize(LINES_CEILING)
  @ValidateNested({ each: true })
  @Type(() => ReceiptLineDto)
  surplus!: ReceiptLineDto[];

  @ApiPropertyOptional({ nullable: true, maxLength: TRANSFER_NOTE_MAX })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(TRANSFER_NOTE_MAX)
  note?: string | null;

  @ApiProperty({ description: 'The `updatedAt` the client read; the close is refused if the transfer changed since' })
  @IsISO8601({ strict: true })
  expectedUpdatedAt!: string;
}

export class CancelTransferDto {
  @ApiPropertyOptional({ description: 'The `updatedAt` the client read; the cancellation is refused if the transfer changed since' })
  @IsOptional()
  @IsISO8601({ strict: true })
  expectedUpdatedAt?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 200, description: 'Why it is cancelled; kept in the audit log' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(200)
  reason?: string | null;
}
