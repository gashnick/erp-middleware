// src/finance/invoices/invoices.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantQueryRunnerService } from '../../database/tenant-query-runner.service';
import { getTenantId, getUserId } from '../../common/context/tenant-context';

interface Invoice {
  id: string;
  invoice_number: string;
  customer_name: string;
  amount: number;
  status: string;
  created_at: Date;
}

@Injectable()
export class InvoicesService {
  constructor(private readonly tenantQueryRunner: TenantQueryRunnerService) {}

  /**
   * Find all invoices for current tenant.
   *
   * Tenant context is automatically extracted from AsyncLocalStorage.
   */
  async findAll(): Promise<Invoice[]> {
    return this.tenantQueryRunner.execute<Invoice>(
      `SELECT * FROM invoices 
       ORDER BY created_at DESC 
       LIMIT 100`,
    );
  }

  /**
   * Find invoice by ID.
   *
   * Only returns invoice if it belongs to current tenant.
   */
  async findById(id: string): Promise<Invoice> {
    const results = await this.tenantQueryRunner.execute<Invoice>(
      'SELECT * FROM invoices WHERE id = $1',
      [id],
    );

    if (!results.length) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }

    return results[0];
  }

  /**
   * Create new invoice.
   *
   * Uses transaction to ensure atomicity.
   */
  async create(dto: {
    invoice_number: string;
    customer_name: string;
    amount: number;
  }): Promise<Invoice> {
    const userId = getUserId();

    return this.tenantQueryRunner.transaction(async (runner) => {
      // Insert invoice
      const result = await runner.query(
        `INSERT INTO invoices (
          invoice_number, 
          customer_name, 
          amount, 
          status,
          currency,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING *`,
        [dto.invoice_number, dto.customer_name, dto.amount, 'draft', 'USD'],
      );

      const invoice = result[0];

      // Log creation in audit table
      await runner.query(
        `INSERT INTO audit_logs (
          resource_type,
          resource_id,
          action,
          user_id,
          created_at
        ) VALUES ($1, $2, $3, $4, NOW())`,
        ['invoice', invoice.id, 'created', userId],
      );

      return invoice;
    });
  }

  /**
   * Update invoice status.
   */
  async updateStatus(id: string, status: string): Promise<Invoice> {
    const userId = getUserId();

    return this.tenantQueryRunner.transaction(async (runner) => {
      // Update invoice
      const result = await runner.query(
        `UPDATE invoices 
         SET status = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [status, id],
      );

      if (!result.length) {
        throw new NotFoundException(`Invoice ${id} not found`);
      }

      // Log update
      await runner.query(
        `INSERT INTO audit_logs (
          resource_type,
          resource_id,
          action,
          user_id,
          metadata,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())`,
        ['invoice', id, 'status_changed', userId, JSON.stringify({ status })],
      );

      return result[0];
    });
  }

  /**
   * Get invoice statistics for current tenant.
   */
  async getStatistics(): Promise<{
    total: number;
    paid: number;
    pending: number;
    overdue: number;
    total_amount: number;
  }> {
    const result = await this.tenantQueryRunner.execute(
      `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'paid') as paid,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'overdue') as overdue,
        COALESCE(SUM(amount), 0) as total_amount
       FROM invoices`,
    );

    return result[0];
  }
}
