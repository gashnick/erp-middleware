// src/etl/services/etl-transformer.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { EncryptionService } from '@common/security/encryption.service';
import { IInvoice, IQuarantineRecord } from '../interfaces/tenant-entities.interface';

@Injectable()
export class EtlTransformerService {
  private readonly logger = new Logger(EtlTransformerService.name);
  private readonly MIN_AMOUNT = 0.01;
  private readonly MAX_AMOUNT = 999999999.99;

  constructor(private readonly encryptionService: EncryptionService) {}

  transformInvoices(rawData: any[], tenantId: string, rawSecret: string, source: string) {
    const validInvoices: IInvoice[] = [];
    // Explicitly typing the array to match the interface
    const quarantine: Partial<IQuarantineRecord>[] = [];

    rawData.forEach((row, i) => {
      // Normalize common CSV field names to internal names
      const normalizedRow: any = {
        ...row,
        // allow both `external_id` and `invoice_id`
        external_id: row.external_id ?? row.invoice_id ?? row.invoiceId ?? row.invoiceId,
        // allow both `amount` and `total_amount`
        amount: row.amount ?? row.total_amount ?? row.totalAmount,
        customer_name: row.customer_name ?? row.customerName,
        invoice_number: row.invoice_number ?? row.invoice_number ?? undefined,
        currency: row.currency ?? 'USD',
        due_date: row.due_date ?? row.dueDate,
      };

      const errors = this.validateInvoice(normalizedRow, i + 1);

      if (errors.length === 0) {
        try {
          validInvoices.push({
            tenant_id: tenantId,
            external_id: String(normalizedRow.external_id).trim(),
            customer_name: this.encryptionService.encrypt(
              String(normalizedRow.customer_name),
              rawSecret,
            ),
            invoice_number: this.encryptionService.encrypt(
              normalizedRow.invoice_number || `AUTO-${Date.now()}-${i}`,
              rawSecret,
            ),
            amount: parseFloat(normalizedRow.amount),
            status: (normalizedRow.status || 'draft').toLowerCase(),
            currency: (normalizedRow.currency || 'USD').toUpperCase(),
            due_date: normalizedRow.due_date ? new Date(normalizedRow.due_date) : undefined,
            is_encrypted: true,
            metadata: { source, sync_date: new Date().toISOString() },
          });
        } catch (e) {
          quarantine.push(
            this.createQuarantineRecord(tenantId, source, row, [`Encryption failed: ${e.message}`]),
          );
        }
      } else {
        quarantine.push(this.createQuarantineRecord(tenantId, source, row, errors));
      }
    });

    return { validInvoices, quarantine };
  }

  private validateInvoice(row: any, index: number): string[] {
    const errors: string[] = [];
    if (!row?.external_id) errors.push(`Row ${index}: Missing external_id`);
    if (!row?.customer_name) errors.push(`Row ${index}: Missing customer_name`);

    const amt = parseFloat(row?.amount);
    if (isNaN(amt)) {
      errors.push(`Row ${index}: Invalid amount format`);
    } else if (amt < this.MIN_AMOUNT || amt > this.MAX_AMOUNT) {
      errors.push(`Row ${index}: Amount out of range`);
    }

    return errors;
  }

  /**
   * Helper to create quarantine records with correct literal types
   */
  private createQuarantineRecord(
    tenantId: string,
    source: string,
    raw_data: any,
    errors: string[],
  ): Partial<IQuarantineRecord> {
    return {
      tenant_id: tenantId,
      source_type: source,
      raw_data,
      errors,
      // Using "as const" or explicit return type ensures 'pending'
      // is treated as the literal type, not a generic string.
      status: 'pending' as const,
    };
  }
}
