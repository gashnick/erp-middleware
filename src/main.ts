import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Get config service
  const config = app.get(ConfigService);

  // Enable validation
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
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, document);

  // Start server
  await app.listen(config.port);
  console.log(` Application running on: http://localhost:${config.port}`);
  console.log(` Swagger docs: http://localhost:${config.port}/api`);
}
bootstrap();
