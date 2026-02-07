import { ConflictException, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { EncryptionService } from '@common/security/encryption.service';
import { EtlService } from '../../etl/services/etl.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly tenantDb: TenantQueryRunnerService,
    private readonly encryptionService: EncryptionService,
    private readonly etlService: EtlService,
  ) {}

  async create(tenantId: string, dto: CreateInvoiceDto) {
    // 1. Fetch Tenant Secret for Field-Level Encryption
    const tenantSecret = await this.etlService.getTenantSecret(tenantId);

    // 2. Encrypt PII (Personally Identifiable Information)
    const encryptedCustomer = this.encryptionService.encrypt(dto.customer_name, tenantSecret);
    const encryptedInvoiceNumber = this.encryptionService.encrypt(
      dto.invoice_number || `INV-${Date.now()}`,
      tenantSecret,
    );

    // 3. Execution via Tenant Context
    // Note: 'executeTenant' handles the schema switch automatically
    const result = await this.tenantDb
      .executeTenant(
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

    return this.decryptInvoice(result[0], tenantSecret);
  }

  async findAll(tenantId: string) {
    // 🛡️ The TenantQueryRunner handles search_path; RLS handles tenant_id isolation.
    const rows = await this.tenantDb.executeTenant(
      'SELECT * FROM invoices ORDER BY created_at DESC',
    );

    if (!rows || rows.length === 0) return [];

    const tenantSecret = await this.etlService.getTenantSecret(tenantId);
    return rows.map((row) => this.decryptInvoice(row, tenantSecret));
  }

  async findOne(id: string, tenantId: string) {
    const rows = await this.tenantDb.executeTenant('SELECT * FROM invoices WHERE id = $1 LIMIT 1', [
      id,
    ]);

    if (!rows || rows.length === 0) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }

    const tenantSecret = await this.etlService.getTenantSecret(tenantId);
    return this.decryptInvoice(rows[0], tenantSecret);
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

    const tenantSecret = await this.etlService.getTenantSecret(tenantId);
    return this.decryptInvoice(result[0], tenantSecret);
  }

  /**
   * Field-Level Decryption Helper
   */
  private decryptInvoice(row: any, secret: string) {
    if (row.is_encrypted && row.customer_name) {
      try {
        row.customer_name = this.encryptionService.decrypt(row.customer_name, secret);
        if (row.invoice_number) {
          row.invoice_number = this.encryptionService.decrypt(row.invoice_number, secret);
        }
      } catch (err) {
        this.logger.error(`Decryption failed for record ${row.id}`);
      }
    }
    return row;
  }
}
