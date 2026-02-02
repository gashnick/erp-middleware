// src/etl/services/etl-transformer.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { EncryptionService } from '@common/security/encryption.service';
import { IInvoice, IQuarantineRecord } from '../interfaces/tenant-entities.interface';

/**
 * ETL Transformer Service
 *
 * Responsibilities:
 * - Validate raw invoice data against business rules
 * - Transform valid records into encrypted invoice entities
 * - Route invalid records to quarantine with structured error messages
 *
 * Design Principles:
 * - Single Responsibility: Only handles data transformation and validation
 * - No side effects: Pure transformation logic
 * - Defensive programming: Validates all inputs
 */
@Injectable()
export class EtlTransformerService {
  private readonly logger = new Logger(EtlTransformerService.name);

  // Business rule constants for maintainability
  private readonly REQUIRED_FIELDS = ['external_id', 'amount', 'customer_name'] as const;
  private readonly DEFAULT_CURRENCY = 'USD';
  private readonly DEFAULT_STATUS = 'draft';
  private readonly MAX_AMOUNT = 999999999.99; // Prevent overflow
  private readonly MIN_AMOUNT = 0.01;

  constructor(private readonly encryptionService: EncryptionService) {}

  /**
   * Transforms raw data into typed Invoices or Quarantine records.
   *
   * @param rawData - Unvalidated data from external sources
   * @param tenantId - Tenant identifier for data isolation
   * @param rawSecret - Decrypted tenant secret for field encryption
   * @param source - Data source identifier for audit trail
   * @returns Segregated valid invoices and quarantined records
   */
  transformInvoices(
    rawData: any[],
    tenantId: string,
    rawSecret: string,
    source: string,
  ): {
    validInvoices: IInvoice[];
    quarantine: Partial<IQuarantineRecord>[];
  } {
    // Defensive: Validate inputs
    if (!Array.isArray(rawData)) {
      this.logger.warn('transformInvoices called with non-array data');
      return { validInvoices: [], quarantine: [] };
    }

    if (!tenantId || !rawSecret || !source) {
      this.logger.error('transformInvoices called with missing required parameters');
      throw new Error(
        'Invalid transformer parameters: tenantId, rawSecret, and source are required',
      );
    }

    const validInvoices: IInvoice[] = [];
    const quarantine: Partial<IQuarantineRecord>[] = [];

    for (let i = 0; i < rawData.length; i++) {
      const row = rawData[i];

      // Guard: Skip null/undefined rows
      if (!row || typeof row !== 'object') {
        quarantine.push(
          this.createQuarantineRecord(tenantId, source, row, [
            `Row ${i + 1}: Invalid data type (expected object, got ${typeof row})`,
          ]),
        );
        continue;
      }

      const validationErrors = this.validateInvoice(row, i + 1);

      if (validationErrors.length === 0) {
        try {
          const invoice = this.transformToInvoice(row, tenantId, rawSecret, source);
          validInvoices.push(invoice);
        } catch (encryptionError) {
          // If encryption fails, quarantine the record
          this.logger.error(`Encryption failed for row ${i + 1}: ${encryptionError.message}`);
          quarantine.push(
            this.createQuarantineRecord(tenantId, source, row, [
              `Encryption error: ${encryptionError.message}`,
            ]),
          );
        }
      } else {
        quarantine.push(this.createQuarantineRecord(tenantId, source, row, validationErrors));
      }
    }

    this.logger.log(
      `Transformation complete: ${validInvoices.length} valid, ${quarantine.length} quarantined`,
    );

    return { validInvoices, quarantine };
  }

  /**
   * Validates a single invoice record against business rules.
   *
   * @param row - Raw data row to validate
   * @param rowNumber - Row index for error messaging (1-based)
   * @returns Array of validation error messages (empty if valid)
   */
  private validateInvoice(row: any, rowNumber: number): string[] {
    const errors: string[] = [];
    const rowPrefix = `Row ${rowNumber}:`;

    // Required field validation
    if (!row.external_id || String(row.external_id).trim() === '') {
      errors.push(`${rowPrefix} Missing or empty external_id`);
    }

    if (!row.customer_name || String(row.customer_name).trim() === '') {
      errors.push(`${rowPrefix} Missing or empty customer_name`);
    }

    // Amount validation
    if (row.amount === null || row.amount === undefined || row.amount === '') {
      errors.push(`${rowPrefix} Missing amount`);
    } else {
      const parsedAmount = parseFloat(row.amount);

      if (isNaN(parsedAmount)) {
        errors.push(`${rowPrefix} Invalid amount format (got: "${row.amount}")`);
      } else if (parsedAmount < this.MIN_AMOUNT) {
        errors.push(`${rowPrefix} Amount must be at least ${this.MIN_AMOUNT}`);
      } else if (parsedAmount > this.MAX_AMOUNT) {
        errors.push(`${rowPrefix} Amount exceeds maximum allowed (${this.MAX_AMOUNT})`);
      }
    }

    // Optional: Status validation (if provided)
    if (row.status) {
      const validStatuses = ['draft', 'pending', 'paid', 'void', 'cancelled'];
      if (!validStatuses.includes(String(row.status).toLowerCase())) {
        errors.push(
          `${rowPrefix} Invalid status "${row.status}" (allowed: ${validStatuses.join(', ')})`,
        );
      }
    }

    // Optional: Currency validation (if provided)
    if (row.currency) {
      const validCurrencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD'];
      if (!validCurrencies.includes(String(row.currency).toUpperCase())) {
        errors.push(
          `${rowPrefix} Invalid currency "${row.currency}" (allowed: ${validCurrencies.join(', ')})`,
        );
      }
    }

    // Optional: Due date validation (if provided)
    if (row.due_date) {
      const dueDate = new Date(row.due_date);
      if (isNaN(dueDate.getTime())) {
        errors.push(`${rowPrefix} Invalid due_date format (got: "${row.due_date}")`);
      }
    }

    return errors;
  }

  /**
   * Transforms a validated row into an encrypted Invoice entity.
   *
   * @param row - Validated raw data row
   * @param tenantId - Tenant identifier
   * @param rawSecret - Decrypted tenant secret for encryption
   * @param source - Data source identifier
   * @returns Encrypted invoice entity ready for database insertion
   * @throws Error if encryption fails
   */
  private transformToInvoice(
    row: any,
    tenantId: string,
    rawSecret: string,
    source: string,
  ): IInvoice {
    // Normalize and sanitize inputs
    const externalId = String(row.external_id).trim();
    const customerName = String(row.customer_name).trim();
    const amount = parseFloat(row.amount);
    const currency = row.currency ? String(row.currency).toUpperCase() : this.DEFAULT_CURRENCY;
    const status = row.status ? String(row.status).toLowerCase() : this.DEFAULT_STATUS;

    // Generate invoice number if not provided
    const invoiceNumber = row.invoice_number
      ? String(row.invoice_number).trim()
      : `AUTO-${Date.now()}-${externalId}`;

    // Encrypt sensitive fields
    const encryptedCustomerName = this.encryptionService.encrypt(customerName, rawSecret);
    const encryptedInvoiceNumber = this.encryptionService.encrypt(invoiceNumber, rawSecret);

    // Parse optional due date
    let dueDate: Date | undefined;
    if (row.due_date) {
      dueDate = new Date(row.due_date);
    }

    return {
      tenant_id: tenantId,
      external_id: externalId,
      customer_name: encryptedCustomerName,
      invoice_number: encryptedInvoiceNumber,
      amount,
      status,
      currency,
      due_date: dueDate,
      is_encrypted: true,
      metadata: {
        source,
        sync_date: new Date().toISOString(),
        original_invoice_number: row.invoice_number || null,
      },
    };
  }

  /**
   * Creates a standardized quarantine record.
   *
   * @param tenantId - Tenant identifier
   * @param source - Data source identifier
   * @param rawData - Original raw data that failed validation
   * @param errors - Array of validation error messages
   * @returns Quarantine record ready for database insertion
   */
  private createQuarantineRecord(
    tenantId: string,
    source: string,
    rawData: any,
    errors: string[],
  ): Partial<IQuarantineRecord> {
    return {
      tenant_id: tenantId,
      source_type: source,
      raw_data: rawData,
      errors, // Stored as JSONB array
      status: 'pending',
    };
  }
}
