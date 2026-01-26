import { MiddlewareConsumer, Module, OnModuleInit } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from '@database/database.module';
import { TenantsModule } from '@tenants/tenants.module';
import { TenantContextMiddleware } from '@common/middleware/tenant-context.middleware';
import { TenantMigrationRunnerService } from '@database/tenant-migration-runner.service';
import { ConfigService } from '@config/config.service';
import { AuthModule } from '@auth/auth.module';
import { UsersModule } from '@users/users.module';
import { FinanceModule } from '@finance/finance.module';
import { InvoicesModule } from '@finance/invoices/invoices.module';
import { ConnectorsModule } from '@connectors/connectors.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AuditModule } from '@common/audit/audit.module';
import { EncryptionModule } from '@common/security/encryption.module';
import { APP_FILTER } from '@nestjs/core';
import { AllExceptionsFilter } from '@common/filters/all-exceptions.filter';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    TenantsModule,
    AuthModule,
    InvoicesModule,
    UsersModule,
    FinanceModule,
    ConnectorsModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'change-me-in-production',
      signOptions: { expiresIn: '1h' },
    }),
    EventEmitterModule.forRoot(),
    AuditModule,
    EncryptionModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule implements OnModuleInit {
  constructor(
    private readonly tenantMigrationRunner: TenantMigrationRunnerService,
    private readonly config: ConfigService,
  ) {}
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenantContextMiddleware)
      .exclude('/health', '/health/database', '*path/swagger', '/api') // Exclude auth and health routes
      .forRoutes('*'); // Apply to all other routes
  }

  async onModuleInit() {
    // Run tenant migrations on startup (if needed)
    if (process.env.RUN_MIGRATIONS_ON_STARTUP === 'true') {
      console.log('🔄 Running tenant migrations on startup...');
      const result = await this.tenantMigrationRunner.runMigrationsForAllTenants();
      console.log(`✅ Migrations complete: ${result.succeeded}/${result.total} succeeded`);
      if (result.failed > 0) {
        console.error(`⚠️  ${result.failed} schemas failed to migrate`);
      }
    }
  }
}
