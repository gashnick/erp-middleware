// src/common/audit/audit.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { getTenantContext } from '../context/tenant-context';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly tenantDb: TenantQueryRunnerService) {}

  /**
   * 🛡️ Fetch logs for the current tenant
   * Uses executePublic because audit_logs are stored in the shared public schema
   * for centralized reporting and cross-tenant security analysis.
   */
  async getTenantLogs(tenantId: string) {
    return await this.tenantDb.executePublic(
      `SELECT * FROM public.audit_logs 
       WHERE tenant_id = $1 
       ORDER BY created_at DESC 
       LIMIT 50`,
      [tenantId],
    );
  }

  /**
   * 🛡️ Foundation Priority 7: Immutable Audit Trail
   * Fire-and-forget logging to ensure performance.
   * Uses executePublic to guarantee the write hits the global audit table.
   */
  async log(params: {
    action: string;
    resourceType?: string;
    resourceId?: string;
    metadata?: Record<string, any>;
  }) {
    // 1. Pull current identity from the scoped context
    const ctx = getTenantContext();

    // 2. Safely extract context variables
    const tenantId = ctx?.tenantId || 'SYSTEM';
    const userId = ctx?.userId || 'SYSTEM';
    const ipAddress = ctx?.ipAddress || null;
    const userAgent = ctx?.userAgent || null;

    // 3. Insert into the public audit table
    // Using fire-and-forget (no 'await') to keep the API response snappy
    this.tenantDb
      .executePublic(
        `INSERT INTO public.audit_logs 
        (tenant_id, user_id, action, resource_type, resource_id, ip_address, user_agent, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          tenantId,
          userId,
          params.action,
          params.resourceType || null,
          params.resourceId || null,
          ipAddress,
          userAgent,
          params.metadata || {},
        ],
      )
      .catch((err) => {
        // Log failure locally. In production, consider a fallback to disk or CloudWatch
        this.logger.error(`CRITICAL: Audit log failed to write: ${err.message}`, err.stack);
      });
  }
}
