import { Injectable, Logger } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { createHash } from 'crypto';

export enum AuditAction {
  READ = 'READ',
  WRITE = 'WRITE',
  DELETE = 'DELETE',
  EXPORT = 'EXPORT',
  KEY_ACCESS = 'KEY_ACCESS',
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  PERMISSION_CHANGE = 'PERMISSION_CHANGE',
}

export interface AuditLogEntry {
  id?: string;
  tenantId: string | null;
  userId: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId: string | null;
  ipAddress: string;
  userAgent: string;
  metadata?: Record<string, any>;
  previousHash?: string;
  currentHash?: string;
  timestamp?: Date;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly tenantDb: TenantQueryRunnerService) {}

  /**
   * Create immutable audit log entry with cryptographic chaining
   */
  async log(entry: AuditLogEntry): Promise<void> {
    try {
      // Get previous log entry hash for chaining
      const prevRows = await this.tenantDb.executePublic(
        `SELECT *, created_at AS timestamp FROM public.audit_logs ORDER BY created_at DESC LIMIT 1`,
        [],
      );

      const previousEntry = prevRows && prevRows.length > 0 ? prevRows[0] : undefined;
      const previousHash = previousEntry?.current_hash || '0'.repeat(64);

      // Calculate current hash
      const currentHash = this.calculateHash({
        ...entry,
        previousHash,
        timestamp: new Date(),
      });

      // Insert audit log (append-only)
      await this.tenantDb.executePublic(
        `
        INSERT INTO public.audit_logs (
          tenant_id, user_id, action, resource_type, resource_id,
          ip_address, user_agent, metadata, previous_hash, current_hash, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        `,
        [
          entry.tenantId,
          entry.userId,
          entry.action,
          entry.resourceType,
          entry.resourceId,
          entry.ipAddress,
          entry.userAgent,
          JSON.stringify(entry.metadata || {}),
          previousHash,
          currentHash,
        ],
      );

      this.logger.log(
        `Audit: ${entry.action} on ${entry.resourceType}:${entry.resourceId} by user:${entry.userId}`,
      );
    } catch (error) {
      this.logger.error(`Failed to create audit log: ${error.message}`);
      // Never throw - audit logging should not break application flow
    }
  }

  /**
   * Verify audit log chain integrity
   */
  async verifyChainIntegrity(): Promise<{ valid: boolean; brokenAt?: number }> {
    const logs = await this.tenantDb.executePublic(
      `SELECT *, created_at AS timestamp FROM public.audit_logs ORDER BY created_at ASC`,
      [],
    );

    let previousHash = '0'.repeat(64);

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];

      if (log.previous_hash !== previousHash) {
        return { valid: false, brokenAt: i };
      }

      const expectedHash = this.calculateHash({
        tenantId: log.tenant_id,
        userId: log.user_id,
        action: log.action,
        resourceType: log.resource_type,
        resourceId: log.resource_id,
        ipAddress: log.ip_address,
        userAgent: log.user_agent,
        metadata: log.metadata,
        previousHash: log.previous_hash,
        timestamp: log.timestamp,
      });

      if (log.current_hash !== expectedHash) {
        return { valid: false, brokenAt: i };
      }

      previousHash = log.current_hash;
    }

    return { valid: true };
  }

  /**
   * Query audit logs for compliance
   */
  async queryLogs(filters: {
    tenantId?: string;
    userId?: string;
    resourceType?: string;
    resourceId?: string;
    action?: AuditAction;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<any[]> {
    const clauses: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (filters.tenantId) {
      clauses.push(`tenant_id = $${idx++}`);
      params.push(filters.tenantId);
    }

    if (filters.userId) {
      clauses.push(`user_id = $${idx++}`);
      params.push(filters.userId);
    }

    if (filters.resourceType) {
      clauses.push(`resource_type = $${idx++}`);
      params.push(filters.resourceType);
    }

    if (filters.resourceId) {
      clauses.push(`resource_id = $${idx++}`);
      params.push(filters.resourceId);
    }

    if (filters.action) {
      clauses.push(`action = $${idx++}`);
      params.push(filters.action);
    }

    if (filters.startDate) {
      clauses.push(`created_at >= $${idx++}`);
      params.push(filters.startDate);
    }

    if (filters.endDate) {
      clauses.push(`created_at <= $${idx++}`);
      params.push(filters.endDate);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = filters.limit || 100;

    const sql = `SELECT *, created_at AS timestamp FROM public.audit_logs ${where} ORDER BY created_at DESC LIMIT ${limit}`;

    return this.tenantDb.executePublic(sql, params);
  }

  /**
   * Export audit logs for compliance (e.g., SOC 2 audit)
   */
  async exportLogs(tenantId: string, startDate: Date, endDate: Date): Promise<string> {
    const logs = await this.queryLogs({ tenantId, startDate, endDate, limit: 100000 });

    // Log the export action itself
    await this.log({
      tenantId,
      userId: null,
      action: AuditAction.EXPORT,
      resourceType: 'audit_logs',
      resourceId: null,
      ipAddress: 'system',
      userAgent: 'system',
      metadata: { startDate, endDate, count: logs.length },
    });

    return JSON.stringify(logs, null, 2);
  }

  /**
   * Calculate SHA-256 hash of audit log entry
   */
  private calculateHash(entry: Partial<AuditLogEntry>): string {
    const data = [
      entry.tenantId || '',
      entry.userId || '',
      entry.action || '',
      entry.resourceType || '',
      entry.resourceId || '',
      entry.ipAddress || '',
      entry.userAgent || '',
      JSON.stringify(entry.metadata || {}),
      entry.previousHash || '',
      entry.timestamp?.toISOString() || '',
    ].join('|');

    return createHash('sha256').update(data).digest('hex');
  }
}
