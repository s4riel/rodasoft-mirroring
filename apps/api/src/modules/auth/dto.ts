import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@rodalaser.local' })
  @IsEmail({}, { message: 'Correo inválido' })
  email!: string;

  @ApiProperty({ example: 'Rodalaser.2026' })
  @IsString()
  @IsNotEmpty({ message: 'La contraseña es obligatoria' })
  @MaxLength(200)
  password!: string;
}

export class RecuperarDto {
  @ApiProperty()
  @IsEmail({}, { message: 'Correo inválido' })
  email!: string;
}

export class RestablecerDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ description: 'Mínimo 10 caracteres, con letras y números' })
  @IsString()
  @MinLength(10, { message: 'La contraseña debe tener al menos 10 caracteres' })
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, { message: 'La contraseña debe tener letras y números' })
  password!: string;
}

export class GoogleExchangeDto {
  @ApiProperty({ description: 'Código de un solo uso devuelto por /auth/google/callback' })
  @IsString()
  @IsNotEmpty()
  code!: string;
}

export class SesionDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty({ description: 'segundos' }) expiresIn!: number;
  @ApiProperty() usuario!: { id: string; email: string; nombre: string; avatarUrl: string | null };
}
