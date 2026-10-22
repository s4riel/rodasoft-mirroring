import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@rodalaser.local' })
  @IsEmail({}, { message: 'Invalid e-mail' })
  email!: string;

  @ApiProperty({ example: 'Rodalaser.2026' })
  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MaxLength(200)
  password!: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @IsEmail({}, { message: 'Invalid e-mail' })
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ description: 'At least 10 characters, with letters and numbers' })
  @IsString()
  @MinLength(10, { message: 'Password must be at least 10 characters' })
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, { message: 'Password must contain letters and numbers' })
  password!: string;
}

export class GoogleExchangeDto {
  @ApiProperty({ description: 'One-time code returned by /auth/google/callback' })
  @IsString()
  @IsNotEmpty()
  code!: string;
}

export class SessionDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty({ description: 'seconds' }) expiresIn!: number;
  @ApiProperty() user!: { id: string; email: string; name: string; avatarUrl: string | null };
}
