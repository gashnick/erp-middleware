import { Injectable } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';

interface ValidInvoice {
  customer_name: string;
  amount: number;
  invoice_number: string;
  status: string;
}

interface QuarantineRecord {
  source_type: string;
  raw_data: any;
  errors: string;
}

@Injectable()
export class EtlService {
  constructor(private readonly tenantDb: TenantQueryRunnerService) {}

  async runInvoiceEtl(tenantId: string, rawData: any[]) {
    const validInvoices: ValidInvoice[] = [];
    const quarantine: QuarantineRecord[] = [];

    for (const row of rawData) {
      const errors: string[] = [];
      if (!row.amount || isNaN(parseFloat(row.amount))) errors.push('Invalid amount');
      if (!row.customer_name) errors.push('Missing customer name');

      if (errors.length === 0) {
        validInvoices.push({
          customer_name: row.customer_name,
          amount: parseFloat(row.amount),
          invoice_number: row.invoice_number || `INV-${Date.now()}`,
          status: row.status || 'draft',
        });
      } else {
        quarantine.push({
          source_type: 'csv',
          raw_data: row,
          errors: JSON.stringify(errors),
        });
      }
    }

    // FIX: tenantDb.transaction accepts (work, tenantId?)
    // We pass it to ensure background tasks have the right context
    return await this.tenantDb.transaction(async (runner) => {
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
  }

  async getQuarantineRecords(tenantId: string) {
    // FIX: Remove the 3rd argument (tenantId).
    // The TenantQueryRunnerService gets this from the Request Context automatically.
    return this.tenantDb.execute(
      `SELECT * FROM quarantine_records WHERE status = 'pending' ORDER BY created_at DESC`,
      [],
    );
  }

  async retryQuarantineRecord(tenantId: string, recordId: string, fixedData: any) {
    return this.tenantDb.transaction(async (runner) => {
      if (!fixedData.customer_name || !fixedData.amount) {
        throw new Error('Data still invalid. Please provide name and amount.');
      }

      await runner.manager.insert('invoices', {
        customer_name: fixedData.customer_name,
        amount: parseFloat(fixedData.amount),
        invoice_number: fixedData.invoice_number,
        status: 'draft',
      });

      await runner.manager.update('quarantine_records', { id: recordId }, { status: 'resolved' });

      return { success: true, message: 'Record synced successfully' };
    }, tenantId);
  }
}
