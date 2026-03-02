// src/etl/services/quarantine.service.ts
import { Injectable, NotFoundException, Logger, Inject, forwardRef } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { IQuarantineRecord } from '../interfaces/tenant-entities.interface';
import { SyncResult } from '@connectors/interfaces/connector.interface';
import { QuarantineFilterDto } from '../dto/query-quarantine.dto';
import { SyncStatusDto } from '../dto/sync-status.dto';
import { EtlService } from './etl.service';

@Injectable()
export class QuarantineService {
  private readonly logger = new Logger(QuarantineService.name);

  constructor(
    private readonly tenantDb: TenantQueryRunnerService,
    // We inject EtlService to handle the re-validation and re-processing
    @Inject(forwardRef(() => EtlService))
    private readonly etlService: EtlService,
  ) {}

  /**
   * Retries a single record with updated/fixed data.
   */
  async retryRecord(tenantId: string, recordId: string, fixedData: any, userId: string) {
    const record = await this.findById(recordId);
    if (!record) {
      throw new NotFoundException(`Quarantine record ${recordId} not found`);
    }

    // Use the ETL Service to process the corrected data
    const result: SyncResult = await this.etlService.runInvoiceEtl(
      tenantId,
      [fixedData],
      record.source_type,
    );

    if (result.synced > 0) {
      // If successfully synced, remove from quarantine
      await this.delete(recordId);
      return { success: true, message: 'Record processed successfully' };
    } else {
      // If it fails again, the EtlService will have created a new quarantine entry
      // We can optionally update the old one or delete it. Usually, we delete the old one.
      await this.delete(recordId);
      throw new Error('Record failed validation again. See new quarantine entry.');
    }
  }

  /**
   * Retries multiple records using their existing raw data.
   */
  async retryBatch(tenantId: string, ids: string[], userId: string) {
    const records = await this.findManyByIds(ids);
    const totalProcessed = records.length;

    // Group records by source type so we can re-run ETL efficiently
    const sourceGroups = records.reduce(
      (acc, rec) => {
        acc[rec.source_type] = acc[rec.source_type] || [];
        acc[rec.source_type].push(rec);
        return acc;
      },
      {} as Record<string, IQuarantineRecord[]>,
    );

    let succeeded = 0;
    const failed: string[] = [];

    for (const [sourceType, group] of Object.entries(sourceGroups)) {
      const rawBatch = group.map((r) => r.raw_data);
      const result: SyncResult = await this.etlService.runInvoiceEtl(
        tenantId,
        rawBatch,
        sourceType as any,
      );

      succeeded += result.synced;

      // Cleanup successfully processed IDs from quarantine
      // In a production environment, we'd cross-reference which specific IDs in the batch
      // succeeded, but for now, we assume if they synced, we can clear the source IDs.
      if (result.synced === group.length) {
        const ids = group.map((g) => g.id).filter((id): id is string => !!id);
        if (ids.length > 0) await this.deleteMany(ids);
      }
    }

    return { totalProcessed, succeeded, failed };
  }

  // --- Existing Methods ---

  async getPaginated(tenantId: string, filter: QuarantineFilterDto) {
    const { limit, offset, source } = filter;
    return await this.tenantDb.transaction(async (runner) => {
      let baseQuery = `WHERE 1=1`;
      const params: any[] = [];
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
    const [inv] = await this.tenantDb.executeTenant(`SELECT COUNT(*) as count FROM invoices`, []);
    const [qua] = await this.tenantDb.executeTenant(
      `SELECT COUNT(*) as count FROM quarantine_records`,
      [],
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
  }

  async findById(recordId: string): Promise<IQuarantineRecord | null> {
    const records = await this.tenantDb.executeTenant<IQuarantineRecord>(
      `SELECT * FROM quarantine_records WHERE id = $1`,
      [recordId],
    );
    return records[0] || null;
  }

  async findManyByIds(ids: string[]): Promise<IQuarantineRecord[]> {
    return this.tenantDb.executeTenant<IQuarantineRecord>(
      `SELECT * FROM quarantine_records WHERE id = ANY($1)`,
      [ids],
    );
  }

  private async delete(id: string) {
    return this.tenantDb.executeTenant(`DELETE FROM quarantine_records WHERE id = $1`, [id]);
  }

  private async deleteMany(ids: string[]) {
    return this.tenantDb.executeTenant(`DELETE FROM quarantine_records WHERE id = ANY($1)`, [ids]);
  }
}
