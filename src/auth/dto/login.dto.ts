import { IsEmail, IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({
    example: 'alex.founder@startup.com',
    description: 'The registered email address of the user',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    example: 'SecurePass123!',
    description: 'The user password',
    format: 'password', // Swagger will hide this field in the UI for security
  })
  @IsString()
  @IsNotEmpty()
  password: string;
}
