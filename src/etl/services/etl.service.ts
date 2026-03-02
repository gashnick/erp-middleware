// src/etl/services/etl.service.ts
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import { SyncResult } from '@connectors/interfaces/connector.interface';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { TenantProvisioningService } from '@tenants/tenant-provisioning.service';
import { ConnectorHealthService } from '@connectors/connector-health.service';
import { runWithTenantContext } from '@common/context/tenant-context';
import { EtlTransformerService } from './etl-transformer.service';
import { QuarantineService } from './quarantine.service';
import {
  IInvoice,
  IContact,
  IExpense,
  IBankTransaction,
  IProduct,
} from '../interfaces/tenant-entities.interface';

export type EntityType = 'invoice' | 'contact' | 'expense' | 'bank_transaction' | 'product';

@Injectable()
export class EtlService {
  private readonly logger = new Logger(EtlService.name);
  private readonly MAX_RETRY_ATTEMPTS = 3;

  constructor(
    private readonly tenantDb: TenantQueryRunnerService,
    private readonly tenantProvisioning: TenantProvisioningService,
    private readonly connectorHealth: ConnectorHealthService,
    private readonly transformer: EtlTransformerService,
    @Inject(forwardRef(() => QuarantineService))
    private readonly quarantine: QuarantineService,
  ) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  async runExternalSync(tenantId: string, connectorId: string): Promise<SyncResult> {
    const tenant = await this.tenantProvisioning.findById(tenantId);
    if (!tenant) throw new BadRequestException('Invalid Tenant Context');

    return runWithTenantContext(
      { tenantId, schemaName: tenant.schema_name, userId: 'system-etl', userRole: 'SYSTEM' },
      async () => {
        const result = await this.tenantDb.executePublic(
          `SELECT * FROM public.connectors WHERE id = $1 AND tenant_id = $2`,
          [connectorId, tenantId],
        );
        const connector = result[0];
        if (!connector) throw new BadRequestException('Connector not found');

        const rawData = await this.fetchFromProvider(connector);
        const syncResult = await this.executeBatch(tenantId, rawData, connector.type, 'invoice');
        await this.connectorHealth.handleSyncSuccess(connectorId);
        return syncResult;
      },
    );
  }

  /**
   * Main entry point for CSV uploads and manual ingestion.
   * entityType determines which transformer + upsert path is used.
   */
  async runEtl(
    tenantId: string,
    rawData: any[],
    source: string,
    entityType: EntityType = 'invoice',
  ): Promise<SyncResult> {
    const tenant = await this.tenantProvisioning.findById(tenantId);
    if (!tenant) throw new BadRequestException('Invalid Tenant');

    return runWithTenantContext(
      { tenantId, schemaName: tenant.schema_name, userId: 'manual-upload', userRole: 'ADMIN' },
      () => this.executeBatchWithRetry(tenantId, rawData, source, entityType),
    );
  }

  /** Backwards-compatible alias used by existing CSV upload controller */
  async runInvoiceEtl(tenantId: string, rawData: any[], source: string): Promise<SyncResult> {
    return this.runEtl(tenantId, rawData, source, 'invoice');
  }

  async retryQuarantineRecord(tenantId: string, recordId: string, fixedData: any, userId: string) {
    const tenant = await this.tenantProvisioning.findById(tenantId);
    if (!tenant) throw new BadRequestException('Tenant not found');

    const record = await this.quarantine.findById(recordId);
    if (!record) throw new NotFoundException('Quarantine record not found');

    const { valid, quarantine } = this.transformer.transformInvoices(
      [fixedData],
      tenantId,
      record.source_type,
    );

    if (quarantine.length > 0) {
      throw new BadRequestException({ message: 'Validation failed', errors: quarantine[0].errors });
    }

    return this.tenantDb.transaction(async (runner) => {
      await this.upsertInvoices(runner, valid);
      await runner.query(`DELETE FROM quarantine_records WHERE id = $1`, [recordId]);
      return { success: true };
    });
  }

  // ── Internal batch execution ───────────────────────────────────────────────

  private async executeBatchWithRetry(
    tenantId: string,
    data: any[],
    source: string,
    entityType: EntityType,
  ): Promise<SyncResult> {
    for (let attempt = 1; attempt <= this.MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        return await this.executeBatch(tenantId, data, source, entityType);
      } catch (error) {
        if (attempt === this.MAX_RETRY_ATTEMPTS) throw error;
        await new Promise((res) => setTimeout(res, 100 * attempt));
      }
    }
    throw new Error('Failed to execute batch after max retry attempts');
  }

  private async executeBatch(
    tenantId: string,
    data: any[],
    source: string,
    entityType: EntityType,
  ): Promise<SyncResult> {
    return this.tenantDb.transaction(async (runner) => {
      let synced = 0;
      let quarantined = 0;

      switch (entityType) {
        case 'invoice': {
          const { valid, quarantine } = this.transformer.transformInvoices(data, tenantId, source);
          if (valid.length > 0) await this.upsertInvoices(runner, valid);
          if (quarantine.length > 0) await this.insertQuarantine(runner, quarantine);
          synced = valid.length;
          quarantined = quarantine.length;
          break;
        }
        case 'contact': {
          const { valid, quarantine } = this.transformer.transformContacts(data, source);
          if (valid.length > 0) await this.upsertContacts(runner, valid);
          if (quarantine.length > 0) await this.insertQuarantine(runner, quarantine);
          synced = valid.length;
          quarantined = quarantine.length;
          break;
        }
        case 'expense': {
          const { valid, quarantine } = this.transformer.transformExpenses(data, source);
          if (valid.length > 0) await this.insertExpenses(runner, valid);
          if (quarantine.length > 0) await this.insertQuarantine(runner, quarantine);
          synced = valid.length;
          quarantined = quarantine.length;
          break;
        }
        case 'bank_transaction': {
          const { valid, quarantine } = this.transformer.transformBankTransactions(data, source);
          if (valid.length > 0) await this.insertBankTransactions(runner, valid);
          if (quarantine.length > 0) await this.insertQuarantine(runner, quarantine);
          synced = valid.length;
          quarantined = quarantine.length;
          break;
        }
        case 'product': {
          const { valid, quarantine } = this.transformer.transformProducts(data, source);
          if (valid.length > 0) await this.upsertProducts(runner, valid);
          if (quarantine.length > 0) await this.insertQuarantine(runner, quarantine);
          synced = valid.length;
          quarantined = quarantine.length;
          break;
        }
        default:
          throw new BadRequestException(`Unsupported entityType: ${entityType}`);
      }

      this.logger.log(
        `ETL [${entityType}] source=${source} total=${data.length} synced=${synced} quarantined=${quarantined}`,
      );

      return { total: data.length, synced, quarantined };
    });
  }

  // ── Upsert / Insert helpers ────────────────────────────────────────────────

  private async upsertInvoices(runner: QueryRunner, invoices: IInvoice[]) {
    const params = invoices.flatMap((inv) => [
      inv.external_id,
      inv.customer_name,
      inv.invoice_number,
      inv.amount,
      inv.status,
      inv.currency,
      inv.invoice_date ?? null,
      inv.due_date ?? null,
      inv.is_encrypted,
      JSON.stringify(inv.metadata ?? {}),
    ]);

    const placeholders = invoices
      .map((_, i) => {
        const b = i * 10;
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}::jsonb)`;
      })
      .join(', ');

    await runner.query(
      `INSERT INTO invoices
         (external_id, customer_name, invoice_number, amount, status, currency, invoice_date, due_date, is_encrypted, metadata)
       VALUES ${placeholders}
       ON CONFLICT (external_id) DO UPDATE SET
         amount        = EXCLUDED.amount,
         status        = EXCLUDED.status,
         customer_name = EXCLUDED.customer_name,
         currency      = EXCLUDED.currency,
         invoice_date  = EXCLUDED.invoice_date,
         due_date      = EXCLUDED.due_date,
         metadata      = EXCLUDED.metadata`,
      params,
    );
  }

  private async upsertContacts(runner: QueryRunner, contacts: IContact[]) {
    const params = contacts.flatMap((c) => [
      c.external_id,
      c.name,
      c.type,
      c.contact_info ? JSON.stringify(c.contact_info) : null,
    ]);

    const placeholders = contacts
      .map((_, i) => {
        const b = i * 4;
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}::jsonb)`;
      })
      .join(', ');

    await runner.query(
      `INSERT INTO contacts (external_id, name, type, contact_info)
       VALUES ${placeholders}
       ON CONFLICT (external_id) DO UPDATE SET
         name         = EXCLUDED.name,
         type         = EXCLUDED.type,
         contact_info = EXCLUDED.contact_info`,
      params,
    );
  }

  private async insertExpenses(runner: QueryRunner, expenses: IExpense[]) {
    const params = expenses.flatMap((e) => [
      e.category,
      e.amount,
      e.currency,
      e.expense_date,
      e.description ?? null,
      JSON.stringify(e.metadata ?? {}),
    ]);

    const placeholders = expenses
      .map((_, i) => {
        const b = i * 6;
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}::jsonb)`;
      })
      .join(', ');

    await runner.query(
      `INSERT INTO expenses (category, amount, currency, expense_date, description, metadata)
       VALUES ${placeholders}`,
      params,
    );
  }

  private async insertBankTransactions(runner: QueryRunner, txns: IBankTransaction[]) {
    const params = txns.flatMap((t) => [
      t.type,
      t.amount,
      t.currency,
      t.transaction_date,
      t.description ?? null,
      t.reference ?? null,
      JSON.stringify(t.metadata ?? {}),
    ]);

    const placeholders = txns
      .map((_, i) => {
        const b = i * 7;
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}::jsonb)`;
      })
      .join(', ');

    await runner.query(
      `INSERT INTO bank_transactions
         (type, amount, currency, transaction_date, description, reference, metadata)
       VALUES ${placeholders}`,
      params,
    );
  }

  private async upsertProducts(runner: QueryRunner, products: IProduct[]) {
    const params = products.flatMap((p) => [p.external_id, p.name, p.price, p.stock]);

    const placeholders = products
      .map((_, i) => {
        const b = i * 4;
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4})`;
      })
      .join(', ');

    await runner.query(
      `INSERT INTO products (external_id, name, price, stock)
       VALUES ${placeholders}
       ON CONFLICT (external_id) DO UPDATE SET
         name  = EXCLUDED.name,
         price = EXCLUDED.price,
         stock = EXCLUDED.stock`,
      params,
    );
  }

  private async insertQuarantine(runner: QueryRunner, records: any[]) {
    const params = records.flatMap((r) => [
      r.source_type,
      JSON.stringify(r.raw_data),
      JSON.stringify(r.errors),
      r.status || 'pending',
    ]);
    const placeholders = records
      .map((_, i) => {
        const b = i * 4;
        return `($${b + 1}, $${b + 2}::jsonb, $${b + 3}::jsonb, $${b + 4})`;
      })
      .join(', ');
    await runner.query(
      `INSERT INTO quarantine_records (source_type, raw_data, errors, status)
       VALUES ${placeholders}`,
      params,
    );
  }

  private async fetchFromProvider(_connector: any): Promise<any[]> {
    return []; // Placeholder — implemented per connector type
  }
}
