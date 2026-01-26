import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { EncryptionService } from '@common/security/encryption.service';
import { EtlService } from '../../etl/etl.service'; // Adjust path as needed

@Injectable()
export class InvoicesService {
  constructor(
    private readonly tenantDb: TenantQueryRunnerService,
    private readonly encryptionService: EncryptionService,
    private readonly etlService: EtlService,
  ) {}

  async create(dto: any, schemaName: string) {
    return this.tenantDb.transaction(async (runner) => {
      await runner.query(`SET search_path TO "${schemaName}", public`);
      return runner.query(`INSERT INTO invoices (amount, status) VALUES ($1, $2) RETURNING *`, [
        dto.amount,
        'draft',
      ]);
    });
  }

  /**
   * Code Complete Principle: Transform data for the consumer.
   * Fetches invoices and decrypts sensitive fields using the Tenant's DEK.
   */
  async findAll(tenantId: string) {
    const rows = await this.tenantDb.execute('SELECT * FROM invoices ORDER BY created_at DESC');

    if (!rows || rows.length === 0) return [];

    // This call is now allowed because we changed the modifier to public
    const tenantSecret = await this.etlService.getTenantSecret(tenantId);

    return rows.map((row) => {
      // Check if the record was marked as encrypted during ingestion
      if (row.is_encrypted && row.customer_name) {
        try {
          row.customer_name = this.encryptionService.decrypt(row.customer_name, tenantSecret);

          if (row.invoice_number) {
            row.invoice_number = this.encryptionService.decrypt(row.invoice_number, tenantSecret);
          }
        } catch (err) {
          // Code Complete: Log error but allow other rows to render
          console.error(`Decryption error for row ${row.id}:`, err.message);
        }
      }
      return row;
    });
  }
}
