import { IsEmail, IsString, IsNotEmpty, MinLength, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum UserRole {
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  ANALYST = 'ANALYST',
  STAFF = 'STAFF',
}

export class CreateUserDto {
  @ApiProperty({
    example: 'alex.founder@startup.com',
    description: 'The email address of the user',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    example: 'SecurePass123!',
    description: 'Password must be at least 8 characters long',
    minLength: 8,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password: string;

  @ApiProperty({
    example: 'Alex Johnson',
    description: 'The full legal name of the user',
  })
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @ApiProperty({
    enum: UserRole,
    example: UserRole.ADMIN,
    description: 'The permissions role assigned to the user',
  })
  @IsEnum(UserRole)
  role: UserRole;
}
