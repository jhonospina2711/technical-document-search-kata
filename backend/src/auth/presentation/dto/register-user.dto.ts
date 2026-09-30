import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { normalizeEmail, trimString } from './transforms';

export class RegisterUserDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  // bcrypt solo considera los primeros 72 bytes: se limita para no truncar en silencio.
  @IsString()
  @MinLength(6)
  @MaxLength(72)
  password: string;
}
