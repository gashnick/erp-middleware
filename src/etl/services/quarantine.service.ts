// src/etl/services/quarantine.service.ts
import { Injectable } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { IQuarantineRecord } from '../interfaces/tenant-entities.interface';
import { QuarantineFilterDto } from '../dto/query-quarantine.dto';
import { SyncStatusDto } from '../dto/sync-status.dto';

@Injectable()
export class QuarantineService {
  constructor(private readonly tenantDb: TenantQueryRunnerService) {}

  async getPaginated(tenantId: string, filter: QuarantineFilterDto) {
    const { limit, offset, source } = filter;

    return await this.tenantDb.transaction(async (runner) => {
      let baseQuery = `WHERE tenant_id = $1`;
      const params: any[] = [tenantId];

      if (source) {
        params.push(source);
        baseQuery += ` AND source_type = $${params.length}`;
      }

      const data = await runner.query(
        `SELECT * FROM quarantine_records ${baseQuery} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );

      const countRes = await runner.query(
        `SELECT COUNT(*) as total FROM quarantine_records ${baseQuery}`,
        params,
      );

      return { data, total: parseInt(countRes[0].total, 10) };
    });
  }

  async getSyncStatus(tenantId: string): Promise<SyncStatusDto> {
    return await this.tenantDb.transaction(async (runner) => {
      const [inv] = await runner.query(
        `SELECT COUNT(*) as count FROM invoices WHERE tenant_id = $1`,
        [tenantId],
      );
      const [qua] = await runner.query(
        `SELECT COUNT(*) as count FROM quarantine_records WHERE tenant_id = $1`,
        [tenantId],
      );

      const totalInvoices = parseInt(inv.count, 10);
      const quarantineCount = parseInt(qua.count, 10);
      const total = totalInvoices + quarantineCount;

      return {
        totalInvoices,
        quarantineCount,
        healthPercentage: total > 0 ? ((totalInvoices / total) * 100).toFixed(1) + '%' : '100%',
        latestActivity: { timestamp: new Date().toISOString() },
      };
    });
  }

  async findById(tenantId: string, recordId: string): Promise<IQuarantineRecord | null> {
    const records = await this.tenantDb.executeTenant<IQuarantineRecord>(
      `SELECT * FROM quarantine_records WHERE id = $1 AND tenant_id = $2`,
      [recordId, tenantId],
    );
    return records[0] || null;
  }

  async findManyByIds(tenantId: string, ids: string[]): Promise<IQuarantineRecord[]> {
    return this.tenantDb.executeTenant<IQuarantineRecord>(
      `SELECT * FROM quarantine_records WHERE id = ANY($1) AND tenant_id = $2`,
      [ids, tenantId],
    );
  }
}
