import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';

/**
 * Config Service
 *
 * Provides type-safe access to configuration values.
 * Wraps NestJS ConfigService with our own typed interface.
 *
 * Code Complete Principle: Strong typing prevents runtime errors
 */

@Injectable()
export class ConfigService {
  constructor(private readonly configService: NestConfigService) {}

  // Environment
  get nodeEnv(): string {
    return this.configService.get<string>('nodeEnv') ?? 'development';
  }

  get isDevelopment(): boolean {
    return this.nodeEnv === 'development';
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get port(): number {
    return this.configService.get<number>('port') ?? 3000; // Default to 3000 if undefined
  }

  // Database
  get databaseHost(): string {
    return this.configService.get<string>('database.host') ?? 'localhost'; // Default to 'localhost' if undefined
  }

  get databasePort(): number {
    return this.configService.get<number>('database.port') ?? 5432; // Default to 5432 if undefined
  }

  get databaseUsername(): string {
    return this.configService.get<string>('database.username') ?? 'default-username';
  }

  get databasePassword(): string {
    return this.configService.get<string>('database.password') ?? '';
  }

  get databaseName(): string {
    return this.configService.get<string>('database.database') ?? 'default-database';
  }

  get databasePoolSize(): number {
    return this.configService.get<number>('database.poolSize') ?? 20; // Default to 10 if undefined
  }

  get databaseConnectionTimeout(): number {
    return this.configService.get<number>('database.connectionTimeout') ?? 5000; // Default to 5000 if undefined
  }

  get databaseSynchronize(): boolean {
    return this.configService.get<boolean>('database.synchronize') ?? false; // Default to false if undefined
  }

  get databaseLogging(): boolean {
    return this.configService.get<boolean>('database.logging') ?? false; // Default to false if undefined
  }

  // JWT
  get jwtSecret(): string {
    const secret = this.configService.get<string>('jwt.secret');
    if (!secret || secret === 'change-me-in-production') {
      if (this.isProduction) {
        throw new Error('JWT_SECRET must be set in production environment');
      }
    }
    return secret ?? '';
  }

  get jwtExpiresIn(): string {
    return this.configService.get<string>('jwt.expiresIn') ?? '1h'; // Default to '1h' if undefined
  }

  get jwtRefreshExpiresIn(): string {
    return this.configService.get<string>('jwt.refreshExpiresIn') ?? '7d'; // Default to '7d' if undefined
  }

  // OpenAI
  get openaiApiKey(): string {
    const key = this.configService.get<string>('openai.apiKey');
    if (!key && this.configService.get<boolean>('features.aiEnabled')) {
      console.warn('⚠️  OPENAI_API_KEY not set - AI features will not work');
    }
    return key ?? '';
  }

  get openaiModel(): string {
    return this.configService.get<string>('openai.model') ?? 'default-model';
  }

  get openaiMaxTokens(): number {
    return this.configService.get<number>('openai.maxTokens') ?? 1000; // Default to 1000 if undefined
  }

  get openaiTemperature(): number {
    return this.configService.get<number>('openai.temperature') ?? 0; // Default to 0 if undefined
  }

  // Redis
  get redisHost(): string {
    return this.configService.get<string>('redis.host') ?? 'localhost'; // Default to 'localhost' if undefined
  }

  get redisPort(): number {
    return this.configService.get<number>('redis.port') ?? 6379; // Default to 6379 if undefined
  }

  get redisPassword(): string {
    return this.configService.get<string>('redis.password') ?? '';
  }

  get redisDb(): number {
    return this.configService.get<number>('redis.db') ?? 0; // Default to 0 if undefined
  }

  // File Upload
  get uploadMaxFileSize(): number {
    return this.configService.get<number>('upload.maxFileSize') ?? 10485760; // Default to 10MB if undefined
  }

  get uploadAllowedMimeTypes(): string[] {
    return this.configService.get<string[]>('upload.allowedMimeTypes') ?? [];
  }

  get uploadDestination(): string {
    return this.configService.get<string>('upload.destination') ?? '';
  }

  // Rate Limiting
  get rateLimitTtl(): number {
    return this.configService.get<number>('rateLimit.ttl') ?? 60; // Default to 60 if undefined
  }

  get rateLimitMax(): number {
    return this.configService.get<number>('rateLimit.limit') ?? 100; // Default to 100 if undefined
  }

  // CORS
  get corsEnabled(): boolean {
    return this.configService.get<boolean>('cors.enabled') ?? false; // Default to false if undefined
  }

  get corsOrigin(): string {
    return this.configService.get<string>('cors.origin') ?? '*'; // Default to '*' if undefined
  }

  get corsCredentials(): boolean {
    return this.configService.get<boolean>('cors.credentials') ?? false; // Default to false if undefined
  }

  // Security
  get bcryptRounds(): number {
    return this.configService.get<number>('security.bcryptRounds') ?? 10; // Default to 10 if undefined
  }

  get sessionSecret(): string {
    const secret = this.configService.get<string>('security.sessionSecret');
    if (!secret || secret === 'change-me-in-production') {
      if (this.isProduction) {
        throw new Error('SESSION_SECRET must be set in production environment');
      }
    }
    return secret ?? '';
  }

  // Logging
  get logLevel(): string {
    return this.configService.get<string>('logging.level') ?? 'info'; // Default to 'info' if undefined
  }

  get logPrettyPrint(): boolean {
    return this.configService.get<boolean>('logging.prettyPrint') ?? false; // Default to false if undefined
  }

  // Features
  get chatEnabled(): boolean {
    return this.configService.get<boolean>('features.chatEnabled') ?? false; // Default to false if undefined
  }

  get aiEnabled(): boolean {
    return this.configService.get<boolean>('features.aiEnabled') ?? false; // Default to false if undefined
  }

  get fileUploadEnabled(): boolean {
    return this.configService.get<boolean>('features.fileUploadEnabled') ?? false; // Default to false if undefined
  }

  /**
   * Get any configuration value by path
   * Use this for custom or dynamic config access
   */
  get<T = any>(path: string): T {
    const value = this.configService.get<T>(path);
    if (value === undefined) {
      throw new Error(`Configuration value for path "${path}" is undefined`);
    }
    return value;
  }

  /**
   * Get configuration value with default fallback
   */
  getOrThrow<T = any>(path: string): T {
    return this.configService.getOrThrow<T>(path);
  }

  /**
   * Validate critical configuration on startup
   * Throws error if essential config is missing
   */
  validateConfig(): void {
    const requiredInProduction = [
      { name: 'JWT_SECRET', value: this.jwtSecret },
      { name: 'SESSION_SECRET', value: this.sessionSecret },
      { name: 'DB_HOST', value: this.databaseHost },
      { name: 'DB_PASSWORD', value: this.databasePassword },
    ];

    if (this.isProduction) {
      for (const config of requiredInProduction) {
        if (
          !config.value ||
          config.value === 'change-me-in-production' ||
          config.value === 'postgres'
        ) {
          throw new Error(`${config.name} must be properly set in production environment`);
        }
      }
    }

    console.log('Configuration validated successfully');
  }
}
