// src/common/audit/audit.listener.ts
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DatabaseService } from '@database/database.service';
import { Repository } from 'typeorm';

@Injectable()
export class AuditService {
  constructor(private readonly db: DatabaseService) {}

  @OnEvent('audit.log')
  async handleAuditLog(payload: any) {
    try {
      await this.db.executeQuery(
        `INSERT INTO public.audit_logs (tenant_id, user_id, action, metadata) 
         VALUES ($1, $2, $3, $4)`,
        [payload.tenantId, payload.userId, payload.action, payload.metadata],
      );
    } catch (err) {
      // We log the error to the console, but the USER never sees it
      // and their transaction remains safe!
      console.error('Background Audit Logging Failed:', err);
    }
  }

  async getTenantLogs(tenantId: string) {
    return this.db.executeQuery(
      `SELECT * FROM public.audit_logs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [tenantId],
    );
  }
}
