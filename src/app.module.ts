import { MiddlewareConsumer, Module, OnModuleInit, RequestMethod } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AppController } from './app.controller';
import { DashboardController } from './dashboard/dashboard.controller';
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
import { RedisModule } from '@nestjs-modules/ioredis';
import { AuditModule } from '@common/audit/audit.module';
import { EncryptionModule } from '@common/security/encryption.module';
import { APP_FILTER } from '@nestjs/core';
import { AllExceptionsFilter } from '@common/filters/all-exceptions.filter';
import { MetricsModule } from '@common/metrics/metrics.module';
import { GraphQLModule } from './graphql/graphql.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AnomalyModule } from './anomaly/anomaly.module';
import { ChatModule } from '@chat/chat.module';
import { KnowledgeGraphModule } from './knowledgeGraph/knowledge-graph.module';
import { FeedbackModule } from './feedback/feedback.module';
import { BullModule } from '@nestjs/bull';
import { PubSubModule } from '@common/pubsub/pubsub.module';
import { AdminModule } from './admin/admin.module';
import { SubscriptionModule } from '@subscription/subscription.module';
import { AlertModule } from '@alerts/alert.module';
import { HrModule } from './hr/hr.module';
import { OpsModule } from '@ops/ops.module';
import { ReportsModule } from 'reports/reports.module';
import { WhatsAppModule } from 'whatsapp/whatsapp.module';

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
    // Provide a global ioredis client for modules that use @InjectRedis()
    RedisModule.forRoot({
      type: 'single',
      options: {
        host: 'localhost',
        port: Number(process.env.REDIS_PORT) || 6379,
      },
    }),
    AuditModule,
    EncryptionModule,
    ConnectorsModule,
    MetricsModule,
    GraphQLModule,
    AnalyticsModule,
    AnomalyModule,
    ChatModule,
    KnowledgeGraphModule,
    FeedbackModule,
    BullModule.forRoot({ redis: { host: process.env.REDIS_HOS, port: 6379 } }),
    PubSubModule,
    AnalyticsModule,
    AdminModule,
    SubscriptionModule,
    AlertModule,
    HrModule,
    OpsModule,
    ReportsModule,
    WhatsAppModule,
  ],
  controllers: [AppController, DashboardController],
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
      .exclude(
        '/health',
        '/health/database',
        '*path/swagger',
        'auth/(.*)',
        'tenants',
        'tenants/(.*)',
      )
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }

  async onModuleInit() {
    console.log('🔍 Checking RUN_MIGRATIONS_ON_STARTUP...');
    // Run tenant migrations on startup (if needed)
    if (process.env.RUN_MIGRATIONS_ON_STARTUP === 'true') {
      console.log('🔄 Running tenant migrations on startup...');
      const result = await this.tenantMigrationRunner.runMigrationsForAllTenants();
      console.log(`✅ Migrations complete: ${result.succeeded}/${result.total} succeeded`);
      if (result.failed > 0) {
        console.error(`⚠️  ${result.failed} schemas failed to migrate`);
      }
    } else {
      console.log('✅ Skipping migrations (RUN_MIGRATIONS_ON_STARTUP not set)');
    }
  }
}
