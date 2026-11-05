import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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

const PAYMENT_METHODS = ['CASH', 'QR', 'CARD', 'TRANSFER', 'CREDIT'] as const;

export class PosPaymentDto {
  /** `CASH` and `QR` are available; the other methods are refused by the service (`PAYMENT_METHOD_NOT_AVAILABLE`). */
  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsIn(PAYMENT_METHODS)
  method!: string;

  /** Cash only. */
  @ApiProperty({ required: false, example: '1.200,00', description: 'What the customer handed over, as typed or as a decimal string' })
  @ValidateIf((payment: PosPaymentDto) => payment.method === 'CASH')
  @IsString()
  @MaxLength(30)
  received?: string;

  /** QR only: the confirmed payment of this checkout. */
  @ApiProperty({ required: false, description: 'The QR payment the cashier got confirmed' })
  @ValidateIf((payment: PosPaymentDto) => payment.method === 'QR')
  @IsUUID()
  paymentId?: string;
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
