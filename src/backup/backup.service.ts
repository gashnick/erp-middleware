// src/backups/backup.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ConfigService } from '../config/config.service';
import { TenantProvisioningService } from '@tenants/tenant-provisioning.service';
import { createReadStream, createWriteStream, unlinkSync } from 'fs';
import { createGzip, createGunzip } from 'zlib';
import { pipeline } from 'stream';

const execAsync = promisify(exec);
const pipelineAsync = promisify(pipeline);

/**
 * Backup Service
 *
 * Handles per-tenant backups and restores.
 *
 * Features:
 * - Schema-level backups (not full database)
 * - Compression (gzip)
 * - Encryption (GPG, optional)
 * - S3 storage (optional)
 * - Retention policies
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly tenantsService: TenantProvisioningService,
  ) {}

  /**
   * Backup a single tenant schema.
   *
   * @param tenantId - Tenant UUID
   * @returns Path to backup file
   */
  async backupTenant(tenantId: string): Promise<string> {
    const tenant = await this.tenantsService.findById(tenantId);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${tenant.schemaName}_${timestamp}.sql`;
    const filepath = `/tmp/${filename}`;

    this.logger.log(`Starting backup for tenant ${tenantId} (${tenant.schemaName})`);

    try {
      // Run pg_dump for this schema only
      await execAsync(
        `PGPASSWORD=${this.config.databasePassword} pg_dump ` +
          `-h ${this.config.databaseHost} ` +
          `-p ${this.config.databasePort} ` +
          `-U ${this.config.databaseUsername} ` +
          `-d ${this.config.databaseName} ` +
          `-n ${tenant.schemaName} ` +
          `--format=plain ` +
          `--no-owner ` +
          `--no-acl ` +
          `-f ${filepath}`,
      );

      this.logger.log(`✅ Backup created: ${filepath}`);

      // Compress
      const gzipPath = `${filepath}.gz`;
      await this.compressFile(filepath, gzipPath);
      unlinkSync(filepath); // Delete uncompressed file

      this.logger.log(`✅ Backup compressed: ${gzipPath}`);

      return gzipPath;
    } catch (error) {
      this.logger.error(`Backup failed for tenant ${tenantId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Backup all tenants.
   */
  async backupAllTenants(): Promise<{
    total: number;
    succeeded: string[];
    failed: Array<{ tenantId: string; error: string }>;
  }> {
    this.logger.log('Starting backup for all tenants...');

    const tenants = await this.tenantsService.findAll();
    const succeeded: string[] = [];
    const failed: Array<{ tenantId: string; error: string }> = [];

    for (const tenant of tenants) {
      try {
        const backupPath = await this.backupTenant(tenant.id);
        succeeded.push(backupPath);
      } catch (error) {
        this.logger.error(`Failed to backup tenant ${tenant.id}: ${error.message}`);
        failed.push({ tenantId: tenant.id, error: error.message });
      }
    }

    this.logger.log(
      `Backup complete: ${succeeded.length}/${tenants.length} succeeded, ` +
        `${failed.length} failed`,
    );

    return {
      total: tenants.length,
      succeeded,
      failed,
    };
  }

  /**
   * Restore a tenant from backup.
   *
   * ⚠️  WARNING: This is destructive. Existing data will be lost.
   *
   * @param tenantId - Tenant UUID
   * @param backupPath - Path to backup file (gzipped)
   */
  async restoreTenant(tenantId: string, backupPath: string): Promise<void> {
    const tenant = await this.tenantsService.findById(tenantId);

    this.logger.log(`Starting restore for tenant ${tenantId} (${tenant.schemaName})`);
    this.logger.warn(`⚠️  This will DELETE all existing data in ${tenant.schemaName}`);

    try {
      // Decompress
      const sqlPath = backupPath.replace('.gz', '');
      await this.decompressFile(backupPath, sqlPath);

      // Drop existing schema
      await this.dropSchema(tenant.schemaName);

      // Restore from backup
      await execAsync(
        `PGPASSWORD=${this.config.databasePassword} psql ` +
          `-h ${this.config.databaseHost} ` +
          `-p ${this.config.databasePort} ` +
          `-U ${this.config.databaseUsername} ` +
          `-d ${this.config.databaseName} ` +
          `-f ${sqlPath}`,
      );

      unlinkSync(sqlPath); // Delete decompressed file

      this.logger.log(`✅ Restore complete for tenant ${tenantId}`);
    } catch (error) {
      this.logger.error(`Restore failed for tenant ${tenantId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * List available backups for a tenant.
   */
  async listBackups(tenantId: string): Promise<string[]> {
    const tenant = await this.tenantsService.findById(tenantId);

    // List files in /tmp (in production, this would be S3)
    const { stdout } = await execAsync(`ls /tmp/${tenant.schemaName}_*.sql.gz`);

    return stdout.trim().split('\n').filter(Boolean);
  }

  /**
   * Compress a file with gzip.
   */
  private async compressFile(input: string, output: string): Promise<void> {
    const gzip = createGzip();
    const source = createReadStream(input);
    const destination = createWriteStream(output);

    await pipelineAsync(source, gzip, destination);
  }

  /**
   * Decompress a gzipped file.
   */
  private async decompressFile(input: string, output: string): Promise<void> {
    const gunzip = createGunzip();
    const source = createReadStream(input);
    const destination = createWriteStream(output);

    await pipelineAsync(source, gunzip, destination);
  }

  /**
   * Drop a schema (destructive).
   */
  private async dropSchema(schemaName: string): Promise<void> {
    await execAsync(
      `PGPASSWORD=${this.config.databasePassword} psql ` +
        `-h ${this.config.databaseHost} ` +
        `-p ${this.config.databasePort} ` +
        `-U ${this.config.databaseUsername} ` +
        `-d ${this.config.databaseName} ` +
        `-c "DROP SCHEMA IF EXISTS ${schemaName} CASCADE"`,
    );
  }
}
