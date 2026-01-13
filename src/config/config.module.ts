import { Module, Global } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { ConfigService } from './config.service';
import configuration from './configuration';

/**
 * Config Module
 *
 * Global module that provides configuration throughout the application.
 * Uses NestJS ConfigModule under the hood with our custom service wrapper.
 *
 * Code Complete Principle: Single source of truth for configuration
 *
 * @Global decorator makes this available everywhere without importing
 */

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env.local', '.env'], // .env.local takes precedence
      cache: true, // Cache configuration for performance
      expandVariables: true, // Allow ${VAR} syntax in .env
      validationOptions: {
        allowUnknown: true, // Allow extra env vars
        abortEarly: false, // Show all validation errors
      },
    }),
  ],
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}
