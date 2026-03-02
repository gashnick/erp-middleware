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
   * Primary migration logic for a single schema.
   *
   * FIX: search_path must be set BOTH:
   *   (a) before ensureMigrationsTable — using set_config with false (session-level)
   *       so it persists across the non-transactional DDL call
   *   (b) inside every transaction — because set_config(true) is transaction-local
   *       and resets when the transaction commits/rolls back
   */
  async runMigrations(schemaName: string, providedFiles?: string[]) {
    this.validateSchemaName(schemaName);
    const files = providedFiles || this.getMigrationFiles();

    const runner = this.dataSource.createQueryRunner();
    await runner.connect();

    const result = { executed: [] as string[], skipped: [] as string[], errors: [] as string[] };

    try {
      // ── (a) Session-level search_path so ensureMigrationsTable resolves correctly ──
      // Using false (not transaction-local) so it persists for the whole connection session.
      await runner.query(`SET search_path TO "${schemaName}", public`);
      this.logger.debug(`[${schemaName}] search_path set at session level`);

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
          // ── (b) Re-set search_path inside the transaction ──────────────────
          // set_config with true = transaction-local, so it applies for the
          // duration of this transaction and resets cleanly on commit/rollback.
          await runner.query(`SET LOCAL search_path TO "${schemaName}", public`);

          const fullPath = join(this.migrationDir, file);
          if (!existsSync(fullPath)) throw new Error(`Migration file missing: ${fullPath}`);

          const migrationModule = require(fullPath);

          let MigrationClass = migrationModule.default;
          if (!MigrationClass) {
            const exportKeys = Object.keys(migrationModule).filter(
              (k) => k !== 'default' && k !== '__esModule',
            );
            if (exportKeys.length > 0) MigrationClass = migrationModule[exportKeys[0]];
          }

          if (!MigrationClass) {
            throw new Error(
              `No migration class found in ${file}. Exports: ${Object.keys(migrationModule).join(', ')}`,
            );
          }

          const instance = new MigrationClass();
          await instance.up(runner);

          // Record in the tenant-schema migrations table (search_path resolves this correctly)
          await runner.query(
            `INSERT INTO "${schemaName}".migrations (name, timestamp) VALUES ($1, $2)`,
            [migrationName, Date.now()],
          );

          await runner.commitTransaction();
          result.executed.push(migrationName);
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
      // Always reset to public and release the connection back to the pool
      try {
        await runner.query(`SET search_path TO public`);
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

    const isProduction = process.env.NODE_ENV === 'production';
    return isProduction
      ? files.filter((f) => f.endsWith('.js'))
      : files.filter((f) => f.endsWith('.ts'));
  }

  private async ensureMigrationsTable(runner: QueryRunner, schema: string) {
    await runner.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".migrations (
        id            SERIAL        PRIMARY KEY,
        name          VARCHAR(255)  NOT NULL UNIQUE,
        timestamp     BIGINT        NOT NULL,
        executed_at   TIMESTAMP     NOT NULL DEFAULT NOW()
      )
    `);
  }

  private validateSchemaName(name: string) {
    const pattern = /^tenant_[a-z0-9_]+_[a-z0-9]+$/;
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
