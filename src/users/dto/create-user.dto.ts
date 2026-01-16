import { IsEmail, IsString, IsIn, IsNotEmpty, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password: string;

  @IsString()
  @IsNotEmpty()
  fullName: string;

  @IsIn(['admin', 'manager', 'analyst', 'staff'])
  role: 'admin' | 'manager' | 'analyst' | 'staff' = 'staff';
}
