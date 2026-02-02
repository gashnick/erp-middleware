import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { EncryptionService } from '@common/security/encryption.service';
import { EtlService } from '../../etl/services/etl.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly tenantDb: TenantQueryRunnerService,
    private readonly encryptionService: EncryptionService,
    private readonly etlService: EtlService,
  ) {}
  async create(tenantId: string, dto: CreateInvoiceDto) {
    // 1. Security Check: Rehydrate the tenant's unique encryption key
    const tenantSecret = await this.etlService.getTenantSecret(tenantId);

    // 2. Data Preparation & Encryption (Priority 6)
    // We encrypt sensitive fields BEFORE they touch the database
    const encryptedCustomer = this.encryptionService.encrypt(dto.customer_name, tenantSecret);
    const encryptedInvoiceNumber = this.encryptionService.encrypt(
      dto.invoice_number || `INV-${Date.now()}`,
      tenantSecret,
    );

    // 3. Execution (Priority 1 & 4)
    // We use the tenantDb to ensure the record is bound to the correct schema/tenant
    const result = await this.tenantDb
      .execute(
        `INSERT INTO invoices (
      tenant_id, 
      invoice_number, 
      customer_name, 
      amount, 
      status, 
      external_id, 
      is_encrypted,
      metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
    RETURNING *`,
        [
          tenantId,
          encryptedInvoiceNumber,
          encryptedCustomer,
          dto.amount,
          dto.status || 'draft',
          dto.external_id || null, // Essential for idempotency syncs
          true, // Mark as encrypted for the decryption helper
          JSON.stringify(dto.metadata || {}),
        ],
      )
      .catch((err) => {
        // Handle Priority 4: Unique Constraint Violations
        if (err.code === '23505') {
          throw new ConflictException(
            `Invoice with external_id ${dto.external_id} already exists.`,
          );
        }
        throw err;
      });

    // 4. Return the decrypted version so the UI gets immediate feedback
    return this.decryptInvoice(result[0], tenantSecret);
  }
  async findAll(tenantId: string) {
    // 🛡️ FOUNDATION: Always filter by tenant_id even in raw SQL
    const rows = await this.tenantDb.execute(
      'SELECT * FROM invoices WHERE tenant_id = $1 ORDER BY created_at DESC',
      [tenantId],
    );

    if (!rows || rows.length === 0) return [];

    const tenantSecret = await this.etlService.getTenantSecret(tenantId);
    return rows.map((row) => this.decryptInvoice(row, tenantSecret));
  }

  async findOne(id: string, tenantId: string) {
    // 🛡️ FOUNDATION: This fixes the 404 Isolation Test.
    // If the ID exists but tenant_id doesn't match, SQL returns 0 rows.
    const rows = await this.tenantDb.execute(
      'SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2 LIMIT 1',
      [id, tenantId],
    );

    if (!rows || rows.length === 0) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }

    const row = rows[0];
    const tenantSecret = await this.etlService.getTenantSecret(tenantId);

    return this.decryptInvoice(row, tenantSecret);
  }

  async update(id: string, tenantId: string, dto: UpdateInvoiceDto) {
    // 🛡️ CRITICAL: The WHERE clause must include BOTH id and tenant_id
    // If Tenant B tries to update Tenant A's invoice, 'affected' will be 0.
    const result = await this.tenantDb.execute(
      `UPDATE invoices 
     SET amount = COALESCE($1, amount), 
         status = COALESCE($2, status)
     WHERE id = $3 AND tenant_id = $4
     RETURNING *`,
      [dto.amount, dto.status, id, tenantId],
    );

    if (!result || result.length === 0) {
      // This is what makes Test 2.2 pass with a 404
      throw new NotFoundException(`Invoice not found or access denied.`);
    }

    const tenantSecret = await this.etlService.getTenantSecret(tenantId);
    return this.decryptInvoice(result[0], tenantSecret);
  }

  /**
   * Private helper to keep decryption logic DRY
   */
  private decryptInvoice(row: any, secret: string) {
    if (row.is_encrypted && row.customer_name) {
      try {
        row.customer_name = this.encryptionService.decrypt(row.customer_name, secret);
        if (row.invoice_number) {
          row.invoice_number = this.encryptionService.decrypt(row.invoice_number, secret);
        }
      } catch (err) {
        console.error(`Decryption failed for record ${row.id}`);
      }
    }
    return row;
  }
}
