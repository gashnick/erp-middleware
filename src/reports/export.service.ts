// src/reports/export.service.ts
//
// Manages secure, time-limited export download links.
//
// Flow:
//   1. createExport()     — stores file buffer in memory cache + creates export_log row
//                           returns { secureToken, expiresAt, downloadUrl }
//   2. downloadByToken()  — validates token, checks expiry, returns buffer, logs access
//
// Storage: in-memory Map keyed by secureToken.
//   This is intentional for Phase 1 — no S3/object storage dependency.
//   Files are evicted from memory after expiry. For production scale,
//   replace the Map with S3 presigned URLs in Stream 6+.
//
// Token expiry: 24 hours from creation (configured via EXPORT_TTL_HOURS env var).

import { Injectable, Logger, NotFoundException, GoneException } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { ExportLog, ReportFormat } from './reports.types';

interface CachedExport {
  buffer: Buffer;
  format: ReportFormat;
  reportName: string;
  expiresAt: Date;
}

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);
  private readonly cache = new Map<string, CachedExport>();

  private static readonly INSERT_EXPORT_SQL = `
    INSERT INTO export_logs
      (report_name, format, file_size, expires_at, created_by)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING
      id,
      secure_token    AS "secureToken",
      report_name     AS "reportName",
      format,
      file_size       AS "fileSize",
      expires_at      AS "expiresAt",
      accessed_at     AS "accessedAt",
      accessed_by_ip  AS "accessedByIp",
      created_by      AS "createdBy",
      created_at      AS "createdAt"
  `;

  private static readonly LOG_ACCESS_SQL = `
    UPDATE export_logs
    SET accessed_at = now(), accessed_by_ip = $2
    WHERE secure_token = $1
    RETURNING
      id,
      secure_token    AS "secureToken",
      report_name     AS "reportName",
      format,
      file_size       AS "fileSize",
      expires_at      AS "expiresAt",
      accessed_at     AS "accessedAt",
      accessed_by_ip  AS "accessedByIp",
      created_by      AS "createdBy",
      created_at      AS "createdAt"
  `;

  private static readonly FIND_BY_TOKEN_SQL = `
    SELECT
      id,
      secure_token    AS "secureToken",
      report_name     AS "reportName",
      format,
      file_size       AS "fileSize",
      expires_at      AS "expiresAt",
      accessed_at     AS "accessedAt",
      accessed_by_ip  AS "accessedByIp",
      created_by      AS "createdBy",
      created_at      AS "createdAt"
    FROM export_logs
    WHERE secure_token = $1
    LIMIT 1
  `;

  private static readonly LIST_EXPORTS_SQL = `
    SELECT
      id,
      secure_token    AS "secureToken",
      report_name     AS "reportName",
      format,
      file_size       AS "fileSize",
      expires_at      AS "expiresAt",
      accessed_at     AS "accessedAt",
      accessed_by_ip  AS "accessedByIp",
      created_by      AS "createdBy",
      created_at      AS "createdAt"
    FROM export_logs
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2
  `;

  constructor(private readonly tenantDb: TenantQueryRunnerService) {}

  /**
   * Stores a report buffer in memory and creates an export_log row.
   * Returns the secureToken the caller uses to build a download URL.
   */
  async createExport(
    buffer: Buffer,
    format: ReportFormat,
    reportName: string,
    createdBy: string,
  ): Promise<ExportLog> {
    const ttlHours = parseInt(process.env.EXPORT_TTL_HOURS ?? '24', 10);
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    const rows = await this.tenantDb.executeTenant<ExportLog>(ExportService.INSERT_EXPORT_SQL, [
      reportName,
      format,
      buffer.length,
      expiresAt.toISOString(),
      createdBy,
    ]);

    const log = rows[0];

    // Cache the buffer in memory keyed by secureToken
    this.cache.set(log.secureToken, {
      buffer,
      format,
      reportName,
      expiresAt,
    });

    this.logger.log(
      `Export created: token=${log.secureToken} format=${format} ` +
        `size=${buffer.length}b expires=${expiresAt.toISOString()}`,
    );

    return log;
  }

  /**
   * Resolves a download by token.
   * Validates expiry, returns the buffer, and logs the access (IP + timestamp).
   * Throws:
   *   404 if token not found
   *   410 Gone if token has expired
   */
  async downloadByToken(
    token: string,
    ipAddress: string,
  ): Promise<{ buffer: Buffer; format: ReportFormat; reportName: string }> {
    // Check DB record first
    const rows = await this.tenantDb.executeTenant<ExportLog>(ExportService.FIND_BY_TOKEN_SQL, [
      token,
    ]);

    if (!rows[0]) {
      throw new NotFoundException('Export link not found or already deleted');
    }

    const log = rows[0];

    if (new Date(log.expiresAt) < new Date()) {
      this.cache.delete(token); // clean up memory too
      throw new GoneException('Export link has expired');
    }

    // Get buffer from memory cache
    const cached = this.cache.get(token);
    if (!cached) {
      // Buffer evicted (server restart) — can't re-serve
      throw new GoneException('Export file is no longer available — please generate a new export');
    }

    // Log the access — fire and forget, never block the download
    this.tenantDb
      .executeTenant(ExportService.LOG_ACCESS_SQL, [token, ipAddress])
      .catch((err) => this.logger.warn(`Failed to log export access: ${err.message}`));

    this.logger.log(`Export downloaded: token=${token} ip=${ipAddress}`);

    return {
      buffer: cached.buffer,
      format: cached.format,
      reportName: cached.reportName,
    };
  }

  /**
   * Lists recent exports for the tenant (audit view).
   */
  async listExports(limit = 20, offset = 0): Promise<ExportLog[]> {
    return this.tenantDb.executeTenant<ExportLog>(ExportService.LIST_EXPORTS_SQL, [limit, offset]);
  }

  /**
   * Evicts expired entries from the in-memory cache.
   * Called periodically by ReportSchedulerService to prevent memory leaks.
   */
  evictExpired(): void {
    const now = new Date();
    let evicted = 0;
    for (const [token, entry] of this.cache.entries()) {
      if (entry.expiresAt < now) {
        this.cache.delete(token);
        evicted++;
      }
    }
    if (evicted > 0) {
      this.logger.debug(`Evicted ${evicted} expired export(s) from memory cache`);
    }
  }
}
