import { Injectable } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';

@Injectable()
export class InvoicesService {
  constructor(private readonly tenantDb: TenantQueryRunnerService) {}

  async create(dto: any, schemaName: string) {
    return this.tenantDb.transaction(async (runner) => {
      // This tells Postgres to look in the tenant's private schema
      await runner.query(`SET search_path TO "${schemaName}", public`);

      return runner.query(`INSERT INTO invoices (amount, status) VALUES ($1, $2) RETURNING *`, [
        dto.amount,
        'draft',
      ]);
    });
  }
}
