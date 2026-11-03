import { IsEmail, IsString, Matches, MinLength } from 'class-validator';
import { IsPassword } from '../../../common/validators/password';

export class RegisterDto {
  @IsEmail({}, { message: 'Invalid email format' })
  email!: string;

  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters' })
  name!: string;

  @IsString()
  @IsPassword()
  password!: string;
}

export class LoginDto {
  @IsEmail({}, { message: 'Invalid email format' })
  email!: string;

  @IsString()
  password!: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  token!: string;

  @IsString()
  @IsPassword()
  newPassword!: string;
}
