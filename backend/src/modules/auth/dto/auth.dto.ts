import { IsEmail, IsString, Matches, MinLength } from 'class-validator';
import { IsPersonName } from '../../../common/validators/person-name';
import { IsPassword } from '../../../common/validators/password';

export class RegisterDto {
  @IsEmail({}, { message: 'Invalid email format' })
  email!: string;

  @IsPersonName()
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
