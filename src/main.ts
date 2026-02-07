import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AuditLoggingInterceptor } from '@common/interceptors/audit-logging.interceptor';
import { AllExceptionsFilter } from '@common/filters/all-exceptions.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // 1. Create Application
  const app = await NestFactory.create(AppModule);

  // 2. Load Configuration
  const config = app.get(ConfigService);

  // 3. Security & CORS
  if (config.corsEnabled) {
    app.enableCors({
      origin: config.corsOrigin,
      credentials: config.corsCredentials,
    });
  }

  // 4. Global API Prefix (Standard Practice)
  app.setGlobalPrefix('api');

  // 5. Global Interceptors
  // AuditLoggingInterceptor will now benefit from the TenantContext set in the middleware
  app.useGlobalInterceptors(new AuditLoggingInterceptor());

  // 6. Global Filters
  // Note: If AllExceptionsFilter needs dependencies from the Nest container,
  // you might prefer app.useGlobalFilters(app.get(AllExceptionsFilter));
  app.useGlobalFilters(new AllExceptionsFilter());

  // 7. Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip properties not in DTO
      forbidNonWhitelisted: true, // Fail if extra properties are sent
      transform: true, // Auto-transform JSON to DTO classes
      transformOptions: {
        enableImplicitConversion: true, // Helps with query params (strings to numbers)
      },
    }),
  );

  // 8. Swagger Documentation Setup
  const swaggerConfig = new DocumentBuilder()
    .setTitle('ERP Middleware API')
    .setDescription('AI-Powered Multi-tenant ERP Infrastructure')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('Auth')
    .addTag('Tenants')
    .addTag('Users')
    .addTag('Finance')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  // 9. Start Server
  const port = config.port || 3000;
  await app.listen(port);

  // 10. Startup Logs
  logger.log(`🚀 Application running on: http://localhost:${port}/api`);
  logger.log(`📚 Swagger docs: http://localhost:${port}/docs`);
  logger.log(`🏗️  Multi-tenant mode: ENABLED (Schema Isolation & RLS)`);
}

bootstrap();
