import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import ormconfig from '../../ormconfig';
import { DatabaseService } from './database.service';
import { ConfigModule } from '../config/config.module';

const ormOptions = {
  ...(ormconfig as any).options,
  // Prevent TypeORM from trying to import TS migration files at runtime in dev/watch mode.
  // Migrations should be executed via CLI against compiled files (or handled separately).
  migrations: [],
  migrationsRun: false,
} as any;

@Module({
  imports: [ConfigModule, TypeOrmModule.forRoot(ormOptions)],
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
