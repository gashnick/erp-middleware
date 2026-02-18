import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseService } from './database.service';
import { ConfigModule } from '../config/config.module';
import { TenantConnectionService } from './tenant-connection.service';
import { TenantMigrationRunnerService } from './tenant-migration-runner.service';
import { TenantQueryRunnerService } from './tenant-query-runner.service';
import { MetricsModule } from '@common/metrics/metrics.module';
import { RLSContextService } from './rls-context.service';

const ormOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_DATABASE || 'erp_middleware',
  migrations: [],
  migrationsRun: false,

  entities: [__dirname + '/../**/*.entity{.ts,.js}'],

  synchronize: false,
  logging: false, // Disable to reduce noise
  extra: {
    max: 20,
    connectionTimeoutMillis: 2000,
  },
  connectTimeoutMS: 2000,
  retryAttempts: 1,
  retryDelay: 1000,
} as any;

@Module({
  imports: [ConfigModule, TypeOrmModule.forRoot(ormOptions), MetricsModule],
  providers: [
    DatabaseService,
    TenantConnectionService,
    TenantMigrationRunnerService,
    TenantQueryRunnerService,
    RLSContextService,
  ],
  exports: [
    DatabaseService,
    TenantConnectionService,
    TenantMigrationRunnerService,
    TenantQueryRunnerService,
    TypeOrmModule,
  ],
})
export class DatabaseModule {}
