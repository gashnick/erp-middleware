import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseService } from './database.service';
import { ConfigModule } from '../config/config.module';
import { TenantConnectionService } from './tenant-connection.service';
import { TenantMigrationRunnerService } from './tenant-migration-runner.service';

const ormOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_DATABASE || 'erp_middleware',
  migrations: [],
  migrationsRun: false,

  // FIX: Use __dirname and pattern that works for both TS and JS
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  // OR if you want to be explicit about all entity files:
  // entities: [
  //   'dist/**/*.entity.js',  // Compiled files (production & watch mode)
  //   'src/**/*.entity.ts',   // Source files (for TypeORM CLI)
  // ],

  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',
  extra: {
    max: 20,
    connectionTimeoutMillis: 5000,
  },
} as any;

@Module({
  imports: [ConfigModule, TypeOrmModule.forRoot(ormOptions)],
  providers: [DatabaseService, TenantConnectionService, TenantMigrationRunnerService],
  exports: [DatabaseService, TenantConnectionService, TenantMigrationRunnerService, TypeOrmModule],
})
export class DatabaseModule {}
