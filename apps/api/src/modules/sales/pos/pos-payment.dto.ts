import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CARD_DECLINE_REASONS, type CardDeclineReason } from '@rodasoft/domain';

const PAYMENT_METHODS = ['CASH', 'QR', 'CARD', 'TRANSFER', 'CREDIT'] as const;

export class PosPaymentDto {
  /** `CASH`, `QR`, `CARD` and `CREDIT` are available; `TRANSFER` is refused by the service (`PAYMENT_METHOD_NOT_AVAILABLE`). */
  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsIn(PAYMENT_METHODS)
  method!: string;

  /** Cash only. */
  @ApiProperty({ required: false, example: '1.200,00', description: 'What the customer handed over, as typed or as a decimal string' })
  @ValidateIf((payment: PosPaymentDto) => payment.method === 'CASH')
  @IsString()
  @MaxLength(30)
  received?: string;

  /** QR and card: the confirmed payment of this checkout. */
  @ApiProperty({ required: false, description: 'The QR or card payment the cashier got confirmed' })
  @ValidateIf((payment: PosPaymentDto) => payment.method === 'QR' || payment.method === 'CARD')
  @IsUUID()
  paymentId?: string;

  /** Credit only (HU-VEN-34): the term in days. The service answers `CREDIT_TERM_INVALID` when it is not a whole number of 1 to 365. */
  @ApiProperty({ required: false, type: 'integer', minimum: 1, maximum: 365, example: 30, description: 'Credit only: the payment term in days (whole number, 1 to 365)' })
  @ValidateIf((payment: PosPaymentDto) => payment.method === 'CREDIT')
  @IsDefined()
  termDays?: number;
}

export class CompletePosCheckoutDto {
  @ApiProperty({ type: [PosPaymentDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => PosPaymentDto)
  payments!: PosPaymentDto[];

  @ApiProperty({ example: '1111.00' })
  @Matches(/^\d{1,12}(\.\d{1,2})?$/)
  expectedTotal!: string;

  @ApiProperty({ description: 'Same key, same sale' })
  @IsString()
  @Length(8, 100)
  idempotencyKey!: string;
}

export class SendReceiptEmailDto {
  @ApiProperty({ example: 'cliente@example.com' })
  @IsString()
  @MaxLength(254)
  email!: string;
}

export class StartPosQrDto {
  @ApiProperty({ description: 'One key per QR attempt: the same key returns the same payment' })
  @IsString()
  @Length(8, 100)
  idempotencyKey!: string;

  @ApiProperty({ example: '1111.00', description: 'The total the cashier saw' })
  @Matches(/^\d{1,12}(\.\d{1,2})?$/)
  expectedTotal!: string;

  @ApiProperty({ required: false, example: '300.00', description: 'Part of the total, when the QR is one line of a mixed payment' })
  @IsOptional()
  @Matches(/^\d{1,12}(\.\d{1,2})?$/)
  amount?: string;
}

export class ConfirmPosQrDto {
  @ApiProperty({ enum: ['APPROVED', 'DECLINED'] })
  @IsIn(['APPROVED', 'DECLINED'])
  outcome!: 'APPROVED' | 'DECLINED';
}

/** HU-VEN-10: opens a card attempt for the whole frozen total. A retry after a decline is a new attempt with a new key. */
export class StartPosCardDto {
  @ApiProperty({ description: 'One key per card attempt: the same key returns the same payment' })
  @IsString()
  @Length(8, 100)
  idempotencyKey!: string;

  @ApiProperty({ example: '1111.00', description: 'The total the cashier saw' })
  @Matches(/^\d{1,12}(\.\d{1,2})?$/)
  expectedTotal!: string;
}

/** The cashier reports what the terminal said: approved with the voucher's code, or declined with the reason. */
export class ConfirmPosCardDto {
  @ApiProperty({ enum: ['APPROVED', 'DECLINED'] })
  @IsIn(['APPROVED', 'DECLINED'])
  outcome!: 'APPROVED' | 'DECLINED';

  @ApiProperty({ required: false, example: 'A1B2C3', description: 'Approved only: the authorization code of the voucher' })
  @ValidateIf((body: ConfirmPosCardDto) => body.outcome === 'APPROVED')
  @IsString()
  @MaxLength(30)
  authorizationCode?: string;

  @ApiProperty({ required: false, enum: CARD_DECLINE_REASONS, description: 'Declined only: why the terminal declined' })
  @ValidateIf((body: ConfirmPosCardDto) => body.outcome === 'DECLINED')
  @IsIn(CARD_DECLINE_REASONS)
  reason?: CardDeclineReason;
}
