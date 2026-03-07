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
        const entityType: EntityType = connector.entity_type || 'invoice';

        const syncResult = await this.executeBatch(tenantId, rawData, connector.type, entityType);
        await this.connectorHealth.handleSyncSuccess(connectorId);
        return syncResult;
      },
    );
  }

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

  async runInvoiceEtl(tenantId: string, rawData: any[], source: string): Promise<SyncResult> {
    return this.runEtl(tenantId, rawData, source, 'invoice');
  }

  async retryQuarantineRecord(tenantId: string, recordId: string, fixedData: any, userId: string) {
    const tenant = await this.tenantProvisioning.findById(tenantId);
    if (!tenant) throw new BadRequestException('Tenant not found');

    const record = await this.quarantine.findById(recordId);
    if (!record) throw new NotFoundException('Quarantine record not found');

    const entityType: EntityType = (record as any).entity_type as EntityType;
    if (!entityType) {
      throw new BadRequestException('Quarantine record is missing entity_type. Cannot retry.');
    }
    const result = await this.runEtl(tenantId, [fixedData], record.source_type, entityType);

    if (result.quarantined > 0) {
      throw new BadRequestException('Validation failed during retry.');
    }

    await this.tenantDb.executeTenant(`DELETE FROM quarantine_records WHERE id = $1`, [recordId]);
    return { success: true };
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
      const handlers: Record<EntityType, () => Promise<{ valid: any[]; quarantine: any[] }>> = {
        invoice: async () => this.transformer.transformInvoices(data, tenantId, source),
        contact: async () => this.transformer.transformContacts(data, source),
        expense: async () => this.transformer.transformExpenses(data, source),
        bank_transaction: async () => this.transformer.transformBankTransactions(data, source),
        product: async () => this.transformer.transformProducts(data, source),
      };

      const handler = handlers[entityType];
      if (!handler) throw new BadRequestException(`Unsupported entityType: ${entityType}`);

      const { valid, quarantine } = await handler();

      if (valid.length > 0) {
        await this.upsertByEntity(runner, entityType, valid);
      }

      if (quarantine.length > 0) {
        await this.insertQuarantine(runner, quarantine, entityType);
      }

      this.logger.log(
        `ETL [${entityType}] source=${source} total=${data.length} synced=${valid.length} quarantined=${quarantine.length}`,
      );

      return { total: data.length, synced: valid.length, quarantined: quarantine.length };
    });
  }

  private async upsertByEntity(runner: QueryRunner, type: EntityType, data: any[]) {
    switch (type) {
      case 'invoice':
        return this.upsertInvoices(runner, data);
      case 'contact':
        return this.upsertContacts(runner, data);
      case 'expense':
        return this.insertExpenses(runner, data);
      case 'bank_transaction':
        return this.insertBankTransactions(runner, data);
      case 'product':
        return this.upsertProducts(runner, data);
    }
  }

  // ── Restored SQL Helpers ──────────────────────────────────────────────────

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
      `INSERT INTO invoices (external_id, customer_name, invoice_number, amount, status, currency, invoice_date, due_date, is_encrypted, metadata)
       VALUES ${placeholders}
       ON CONFLICT (external_id) DO UPDATE SET
       amount = EXCLUDED.amount, status = EXCLUDED.status, customer_name = EXCLUDED.customer_name,
       currency = EXCLUDED.currency, invoice_date = EXCLUDED.invoice_date, due_date = EXCLUDED.due_date, metadata = EXCLUDED.metadata`,
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
      .map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4}::jsonb)`)
      .join(', ');
    await runner.query(
      `INSERT INTO contacts (external_id, name, type, contact_info) VALUES ${placeholders}
       ON CONFLICT (external_id) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, contact_info = EXCLUDED.contact_info`,
      params,
    );
  }

  /**
   * Inserts expenses with vendor linking.
   *
   * Pipeline (runs inside the parent transaction — atomic with the batch):
   *   1. Collect unique vendorNames from the batch
   *   2. Upsert each vendor into contacts once (external_id = 'vendor-{slug}')
   *   3. Insert all expenses with vendor_id populated
   */
  private async insertExpenses(runner: QueryRunner, expenses: IExpense[]) {
    // Step 1 — unique vendor names in this batch
    const uniqueVendorNames = [
      ...new Set(expenses.map((e) => (e as any).vendorName).filter(Boolean)),
    ] as string[];

    // Step 2 — upsert each vendor into contacts, collect name → id mapping
    const vendorIdMap = new Map<string, string>();
    for (const vendorName of uniqueVendorNames) {
      // Stable external_id from name — prevents duplicate contacts on re-upload
      const externalId = `vendor-${vendorName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      const rows = await runner.query(
        `INSERT INTO contacts (external_id, name, type)
       VALUES ($1, $2, 'vendor')
       ON CONFLICT (external_id) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
        [externalId, vendorName],
      );
      if (rows[0]?.id) {
        vendorIdMap.set(vendorName, rows[0].id);
        this.logger.debug(`Vendor resolved: "${vendorName}" → ${rows[0].id}`);
      }
    }

    // Step 3 — insert expenses with vendor_id linked
    const params = expenses.flatMap((e) => [
      e.category,
      (e as any).vendorName ? (vendorIdMap.get((e as any).vendorName) ?? null) : null,
      e.amount,
      e.currency,
      e.expense_date,
      e.description ?? null,
      JSON.stringify(e.metadata ?? {}),
    ]);
    const placeholders = expenses
      .map((_, i) => {
        const b = i * 7;
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}::jsonb)`;
      })
      .join(', ');
    await runner.query(
      `INSERT INTO expenses (category, vendor_id, amount, currency, expense_date, description, metadata)
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
      .map(
        (_, i) =>
          `($${i * 7 + 1}, $${i * 7 + 2}, $${i * 7 + 3}, $${i * 7 + 4}, $${i * 7 + 5}, $${i * 7 + 6}, $${i * 7 + 7}::jsonb)`,
      )
      .join(', ');
    await runner.query(
      `INSERT INTO bank_transactions (type, amount, currency, transaction_date, description, reference, metadata) VALUES ${placeholders}`,
      params,
    );
  }

  private async upsertProducts(runner: QueryRunner, products: IProduct[]) {
    const params = products.flatMap((p) => [p.external_id, p.name, p.price, p.stock]);
    const placeholders = products
      .map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`)
      .join(', ');
    await runner.query(
      `INSERT INTO products (external_id, name, price, stock) VALUES ${placeholders}
       ON CONFLICT (external_id) DO UPDATE SET name = EXCLUDED.name, price = EXCLUDED.price, stock = EXCLUDED.stock`,
      params,
    );
  }

  private async insertQuarantine(runner: QueryRunner, records: any[], entityType: EntityType) {
    const params = records.flatMap((r) => [
      r.source_type,
      JSON.stringify(r.raw_data),
      JSON.stringify(r.errors),
      r.status || 'pending',
      entityType,
    ]);
    const placeholders = records
      .map(
        (_, i) =>
          `($${i * 5 + 1}, $${i * 5 + 2}::jsonb, $${i * 5 + 3}::jsonb, $${i * 5 + 4}, $${i * 5 + 5})`,
      )
      .join(', ');
    await runner.query(
      `INSERT INTO quarantine_records (source_type, raw_data, errors, status, entity_type) VALUES ${placeholders}`,
      params,
    );
  }

  private async fetchFromProvider(_connector: any): Promise<any[]> {
    return []; // Placeholder logic
  }
}
