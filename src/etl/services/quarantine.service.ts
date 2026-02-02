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
    let query = `SELECT * FROM quarantine_records WHERE tenant_id = $1`;
    const params: any[] = [tenantId];

    if (source) {
      params.push(source);
      query += ` AND source_type = $${params.length}`;
    }

    const dataQuery = `${query} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const countQuery = `SELECT COUNT(*) as total FROM (${query}) as subquery`;

    const [data, countRes] = await Promise.all([
      this.tenantDb.execute<IQuarantineRecord>(dataQuery, [...params, limit, offset]),
      this.tenantDb.execute(countQuery, params),
    ]);

    return { data, total: parseInt(countRes[0].total, 10) };
  }

  async getSyncStatus(tenantId: string): Promise<SyncStatusDto> {
    const [invoiceRes, quarantineRes] = await Promise.all([
      this.tenantDb.execute(`SELECT COUNT(*) as count FROM invoices WHERE tenant_id = $1`, [
        tenantId,
      ]),
      this.tenantDb.execute(
        `SELECT COUNT(*) as count FROM quarantine_records WHERE tenant_id = $1`,
        [tenantId],
      ),
    ]);

    const totalInvoices = parseInt(invoiceRes[0].count, 10);
    const quarantineCount = parseInt(quarantineRes[0].count, 10);
    const totalProcessed = totalInvoices + quarantineCount;

    return {
      totalInvoices,
      quarantineCount,
      healthPercentage:
        totalProcessed > 0 ? ((totalInvoices / totalProcessed) * 100).toFixed(1) + '%' : '100%',
      latestActivity: { timestamp: new Date().toISOString() },
    };
  }

  async findById(tenantId: string, recordId: string): Promise<IQuarantineRecord | null> {
    const [record] = await this.tenantDb.execute<IQuarantineRecord>(
      `SELECT * FROM quarantine_records WHERE id = $1 AND tenant_id = $2`,
      [recordId, tenantId],
    );
    return record || null;
  }

  async findManyByIds(tenantId: string, ids: string[]): Promise<IQuarantineRecord[]> {
    return this.tenantDb.execute<IQuarantineRecord>(
      `SELECT * FROM quarantine_records WHERE id = ANY($1) AND tenant_id = $2`,
      [ids, tenantId],
    );
  }
}
