// src/invoices/invoices.service.ts
import { ConflictException, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { EncryptionService } from '@common/security/encryption.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly tenantDb: TenantQueryRunnerService,
    private readonly encryptionService: EncryptionService,
    // EtlService dependency removed as getTenantSecret is no longer needed
  ) {}

  /**
   * Creates an invoice with field-level encryption.
   */
  async create(tenantId: string, dto: CreateInvoiceDto) {
    // 1. Encrypt PII using the internalized Master Key logic
    const encryptedCustomer = this.encryptionService.encrypt(dto.customer_name);
    const encryptedInvoiceNumber = this.encryptionService.encrypt(
      dto.invoice_number || `INV-${Date.now()}`,
    );

    // 2. Database Execution
    // search_path handles schema isolation; no tenant_id column exists in the tenant schema.
    const result = await this.tenantDb
      .executeTenant(
        `INSERT INTO invoices (
          invoice_number,
          customer_name,
          amount,
          status,
          external_id,
          is_encrypted,
          metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *`,
        [
          encryptedInvoiceNumber,
          encryptedCustomer,
          dto.amount,
          dto.status || 'draft',
          dto.external_id || null,
          true,
          JSON.stringify(dto.metadata || {}),
        ],
      )
      .catch((err) => {
        if (err.code === '23505') {
          throw new ConflictException(
            `Invoice with external_id ${dto.external_id} already exists.`,
          );
        }
        throw err;
      });

    return this.decryptInvoice(result[0]);
  }

  async findAll(tenantId: string) {
    const rows = await this.tenantDb.executeTenant(
      'SELECT * FROM invoices ORDER BY created_at DESC',
      [],
    );

    if (!rows || rows.length === 0) return [];

    return rows.map((row) => this.decryptInvoice(row));
  }

  async findOne(id: string, tenantId: string) {
    const rows = await this.tenantDb.executeTenant('SELECT * FROM invoices WHERE id = $1 LIMIT 1', [
      id,
    ]);

    if (!rows || rows.length === 0) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }

    return this.decryptInvoice(rows[0]);
  }

  async update(id: string, tenantId: string, dto: UpdateInvoiceDto) {
    const result = await this.tenantDb.executeTenant(
      `UPDATE invoices
       SET amount = COALESCE($1, amount),
           status = COALESCE($2, status)
       WHERE id = $3
       RETURNING *`,
      [dto.amount, dto.status, id],
    );

    if (!result || result.length === 0) {
      throw new NotFoundException(`Invoice not found or access denied.`);
    }

    return this.decryptInvoice(result[0]);
  }

  /**
   * Field-Level Decryption Helper
   * No longer requires 'secret' parameter as EncryptionService handles it.
   */
  private decryptInvoice(row: any) {
    if (row.is_encrypted && row.customer_name) {
      try {
        row.customer_name = this.encryptionService.decrypt(row.customer_name);
        if (row.invoice_number) {
          row.invoice_number = this.encryptionService.decrypt(row.invoice_number);
        }
      } catch (err) {
        this.logger.error(`Decryption failed for record ${row.id}: ${err.message}`);
        // Optionally: mark row as "corrupted" or keep encrypted value
      }
    }
    return row;
  }
}
