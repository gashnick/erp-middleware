// src/common/audit/audit.service.ts
import { Injectable } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { getTenantContext } from '../context/tenant-context';

@Injectable()
export class AuditService {
  constructor(private readonly tenantDb: TenantQueryRunnerService) {}
  /**
   * 🛡️ Fetch logs for the current tenant
   * This is what the controller is currently missing.
   */
  async getTenantLogs(tenantId: string) {
    return await this.tenantDb.execute(
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
   */
  async log(params: {
    action: string;
    resourceType?: string;
    resourceId?: string;
    metadata?: Record<string, any>;
  }) {
    // 1. Pull current identity from the scoped context
    const { tenantId, userId, ipAddress, userAgent } = getTenantContext();

    // 2. Insert into the public audit table
    // Using background execution (no 'await') to prevent blocking the main request
    this.tenantDb
      .execute(
        `INSERT INTO public.audit_logs 
       (tenant_id, user_id, action, resource_type, resource_id, ip_address, user_agent, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          tenantId,
          userId,
          params.action,
          params.resourceType,
          params.resourceId,
          ipAddress || null,
          userAgent || null,
          params.metadata || {},
        ],
      )
      .catch((err) => {
        // In a real foundation, you might pipe failed audits to a backup log file
        console.error('CRITICAL: Audit log failed to write:', err.message);
      });
  }
}
