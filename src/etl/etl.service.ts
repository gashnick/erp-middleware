import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { AuditService } from '@common/audit/audit.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EncryptionService } from '@common/security/encryption.service';
import { TenantProvisioningService } from '@tenants/tenant-provisioning.service';
import { ValidInvoice } from './interfaces/invoice-data.interface';
import { ConfigService } from '@nestjs/config';

interface QuarantineRecord {
  source_type: string;
  raw_data: any;
  errors: string;
}

@Injectable()
export class EtlService {
  constructor(
    private readonly tenantDb: TenantQueryRunnerService,
    private readonly auditService: AuditService,
    private readonly eventEmitter: EventEmitter2,
    private readonly encryptionService: EncryptionService,
    private readonly tenantProvisioning: TenantProvisioningService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Main ETL Entry point for bulk uploads
   */
  async runInvoiceEtl(tenantId: string, rawData: any[]) {
    // 1. Fetch & Decrypt Tenant Secret (Envelope Encryption)
    const rawSecret = await this.getTenantSecret(tenantId);

    const validInvoices: ValidInvoice[] = [];
    const quarantine: QuarantineRecord[] = [];

    // 2. Transform & Validate
    for (const row of rawData) {
      const errors: string[] = [];
      if (!row.amount || isNaN(parseFloat(row.amount))) errors.push('Invalid amount');
      if (!row.customer_name) errors.push('Missing customer name');

      if (errors.length === 0) {
        validInvoices.push({
          // AES-256-GCM Encryption for PII
          customer_name: this.encryptionService.encrypt(row.customer_name, rawSecret),
          invoice_number: this.encryptionService.encrypt(
            row.invoice_number || `INV-${Date.now()}`,
            rawSecret,
          ),
          amount: parseFloat(row.amount),
          status: row.status || 'draft',
          is_encrypted: true,
          metadata: JSON.stringify({ source: 'csv_upload' }), // For AI Layer
        });
      } else {
        quarantine.push({
          source_type: 'csv',
          raw_data: row,
          errors: JSON.stringify(errors),
        });
      }
    }

    // 3. Persistent Load via Transaction
    const result = await this.tenantDb.transaction(async (runner) => {
      if (validInvoices.length > 0) {
        await runner.manager.insert('invoices', validInvoices);
      }
      if (quarantine.length > 0) {
        await runner.manager.insert('quarantine_records', quarantine);
      }
      return {
        total: rawData.length,
        synced: validInvoices.length,
        quarantined: quarantine.length,
      };
    }, tenantId);

    // 4. Observability: Structured Logging
    this.eventEmitter.emit('audit.log', {
      tenantId,
      action: 'DATA_SYNC_CSV',
      metadata: {
        total_records: result.total,
        success: result.synced,
        failed: result.quarantined,
      },
    });

    return result;
  }

  /**
   * Handle the "Fix UI" flow for quarantined records
   */
  async retryQuarantineRecord(tenantId: string, recordId: string, fixedData: any, userId: string) {
    const rawSecret = await this.getTenantSecret(tenantId);

    const result = await this.tenantDb.transaction(async (runner) => {
      if (!fixedData.customer_name || !fixedData.amount) {
        throw new Error('Data still invalid. Please provide name and amount.');
      }

      // 1. Insert fixed record with encryption
      await runner.manager.insert('invoices', {
        customer_name: this.encryptionService.encrypt(fixedData.customer_name, rawSecret),
        invoice_number: this.encryptionService.encrypt(fixedData.invoice_number, rawSecret),
        amount: parseFloat(fixedData.amount),
        status: 'draft',
        is_encrypted: true,
      });

      // 2. Mark quarantine as resolved
      await runner.manager.update('quarantine_records', { id: recordId }, { status: 'resolved' });

      return { success: true };
    }, tenantId);

    // 3. Log the human intervention (Audit Trail)
    this.eventEmitter.emit('audit.log', {
      tenantId,
      userId,
      action: 'QUARANTINE_RETRY',
      metadata: { recordId, fixed_fields: Object.keys(fixedData) },
    });

    return result;
  }

  /**
   * Internal Helper for Envelope Decryption
   */
  async getTenantSecret(tenantId: string): Promise<string> {
    const tenant = await this.tenantProvisioning.findById(tenantId);

    if (!tenant || !tenant.tenant_secret) {
      throw new InternalServerErrorException('Tenant security context not found');
    }

    const masterKey = this.configService.get<string>('security.globalMasterKey');

    if (!masterKey || masterKey.length !== 32) {
      throw new InternalServerErrorException('System Configuration Error: Invalid Master Key');
    }

    return this.encryptionService.decrypt(tenant.tenant_secret, masterKey);
  }

  async getQuarantineRecords(tenantId: string) {
    return this.tenantDb.execute(
      `SELECT * FROM quarantine_records WHERE status = 'pending' ORDER BY created_at DESC`,
      [],
    );
  }
}
