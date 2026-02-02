import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AuditLoggingInterceptor } from '@common/interceptors/audit-logging.interceptor';
import { AllExceptionsFilter } from '@common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Get config service
  const config = app.get(ConfigService);

  // Enable CORS
  if (config.corsEnabled) {
    app.enableCors({
      origin: config.corsOrigin,
      credentials: config.corsCredentials,
    });
  }
  // Logging Intreceptor can be added here if needed
  app.useGlobalInterceptors(new AuditLoggingInterceptor());

  app.useGlobalFilters(new AllExceptionsFilter());
  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip unknown properties
      forbidNonWhitelisted: true, // Throw error on unkown properties
      transform: true, // Transform payloads to DTO Types
    }),
  );

  // Setup Swagger
  const swaggerConfig = new DocumentBuilder()
    .setTitle('ERP Middleware API')
    .setDescription('AI-Powered ERP Middleware')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('Auth', 'Authentication endpoints')
    .addTag('Tentants', 'Tenant management endpoints')
    .addTag('Users', 'User management endpoints')
    .addTag('Finance', 'Finance management endpoints')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, document);

  // Start server
  await app.listen(config.port);
  console.log(` Application running on: http://localhost:${config.port}`);
  console.log(` Swagger docs: http://localhost:${config.port}/api`);
  console.log('Multi-tenant mode: ENABLED (schema per tenant)');
}
bootstrap();
