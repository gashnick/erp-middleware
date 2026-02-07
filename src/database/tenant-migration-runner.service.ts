import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';

@Injectable()
export class TenantMigrationRunnerService {
  private readonly logger = new Logger(TenantMigrationRunnerService.name);
  private readonly migrationDir = join(process.cwd(), 'src/database/migrations/tenant');

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * System-wide migration tool (used by CLI or Admin tasks)
   */
  async runMigrationsForAllTenants() {
    this.logger.log('🚀 Starting batch migration for all tenant schemas');
    const schemas = await this.getAllTenantSchemas();
    const migrationFiles = this.getMigrationFiles();

    const summary = { total: schemas.length, succeeded: 0, failed: 0 };

    for (const schema of schemas) {
      try {
        const result = await this.runMigrations(schema, migrationFiles);
        if (result.errors.length === 0) summary.succeeded++;
        else summary.failed++;
      } catch (err) {
        summary.failed++;
        this.logger.error(`❌ [${schema}] Migration failed: ${err.message}`);
      }
    }
    return summary;
  }

  /**
   * Primary migration logic for a single schema
   */
  async runMigrations(schemaName: string, providedFiles?: string[]) {
    this.validateSchemaName(schemaName);
    const files = providedFiles || this.getMigrationFiles();

    // We create a fresh runner for migrations to ensure total isolation
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();

    const result = { executed: [] as string[], skipped: [] as string[], errors: [] as string[] };

    try {
      // 🔒 SECURITY: Use local set_config to prevent leakage to the connection pool
      // This matches the logic in your TenantQueryRunnerService
      await runner.query('SELECT set_config($1, $2, true)', [
        'search_path',
        `"${schemaName}", public`,
      ]);

      await this.ensureMigrationsTable(runner, schemaName);

      const executedRows = await runner.query(`SELECT name FROM "${schemaName}".migrations`);
      const executedNames = new Set(executedRows.map((r: any) => r.name));

      for (const file of files) {
        const migrationName = file.replace(/\.(ts|js)$/, '');

        if (executedNames.has(migrationName)) {
          result.skipped.push(migrationName);
          continue;
        }

        this.logger.log(`📡 [${schemaName}] Executing: ${migrationName}`);
        await runner.startTransaction();

        try {
          const fullPath = join(this.migrationDir, file);
          if (!existsSync(fullPath)) throw new Error(`Migration file missing: ${fullPath}`);

          // Use require for better compatibility with TypeScript in development
          const migrationModule = require(fullPath);
          
          // Try multiple ways to get the migration class
          let MigrationClass = migrationModule.default;
          
          if (!MigrationClass) {
            // Try named exports
            const exportKeys = Object.keys(migrationModule).filter(k => k !== 'default' && k !== '__esModule');
            if (exportKeys.length > 0) {
              MigrationClass = migrationModule[exportKeys[0]];
            }
          }

          if (!MigrationClass) {
            const allKeys = Object.keys(migrationModule);
            throw new Error(
              `No migration class found in ${file}. Available exports: ${allKeys.join(', ')}`,
            );
          }

          const instance = new MigrationClass();

          // Run the migration 'up' logic
          await instance.up(runner);

          // Record migration success
          await runner.query(
            `INSERT INTO "${schemaName}".migrations (name, timestamp) VALUES ($1, $2)`,
            [migrationName, Date.now()],
          );

          await runner.commitTransaction();
          result.executed.push(migrationName);
          // Mark as executed to prevent duplicate execution when both .ts and .js
          // versions of the same migration file exist in the migrations directory.
          executedNames.add(migrationName);
          this.logger.log(`✅ [${schemaName}] Success: ${migrationName}`);
        } catch (error) {
          if (runner.isTransactionActive) {
            await runner.rollbackTransaction();
          } else {
            this.logger.warn(
              `⚠️ [${schemaName}] No active transaction to rollback for ${migrationName}`,
            );
          }

          this.logger.error(`🔥 [${schemaName}] Failed: ${migrationName} -> ${error.message}`);
          result.errors.push(error.message);
          throw error;
        }
      }
    } finally {
      // 🛡️ Always reset path and release the connection
      try {
        await runner.query('SELECT set_config($1, $2, true)', ['search_path', 'public']);
      } catch (e) {}
      await runner.release();
    }

    return result;
  }

  private getMigrationFiles(): string[] {
    if (!existsSync(this.migrationDir)) {
      this.logger.error(`❗ Directory missing: ${this.migrationDir}`);
      return [];
    }

    const files = readdirSync(this.migrationDir)
      .filter((f) => f.endsWith('.ts') || f.endsWith('.js'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    // In production, prefer .js files over .ts files
    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction) {
      return files.filter((f) => f.endsWith('.js'));
    }

    // In development, prefer .ts files
    return files.filter((f) => f.endsWith('.ts'));
  }

  private async ensureMigrationsTable(runner: QueryRunner, schema: string) {
    // Ensuring the tracking table exists within the specific tenant schema
    await runner.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        timestamp BIGINT NOT NULL,
        executed_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
  }

  /**
   * Matches the pattern used in TenantQueryRunnerService
   */
  private validateSchemaName(name: string) {
    const pattern = /^tenant_[a-z0-9_]+_[a-z0-9]+$/;
    // Allow 'public' for certain internal tests, otherwise strict tenant pattern
    if (name !== 'public' && !pattern.test(name)) {
      throw new InternalServerErrorException(`Invalid schema format: ${name}`);
    }
  }

  async getAllTenantSchemas(): Promise<string[]> {
    const result = await this.dataSource.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'tenant_%'`,
    );
    return result.map((r: any) => r.schema_name);
  }
}
