import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsString, Length, Matches, MaxLength, ValidateNested } from 'class-validator';

const PAYMENT_METHODS = ['CASH', 'QR', 'CARD', 'TRANSFER', 'CREDIT'] as const;

export class PosPaymentDto {
  /** Only `CASH` is available for now; the other methods are refused by the service (`PAYMENT_METHOD_NOT_AVAILABLE`). */
  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsIn(PAYMENT_METHODS)
  method!: string;

  @ApiProperty({ example: '1.200,00', description: 'What the customer handed over, as typed or as a decimal string' })
  @IsString()
  @MaxLength(30)
  received!: string;
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
