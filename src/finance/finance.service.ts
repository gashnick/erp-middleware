// src/modules/finance/finance.service.ts
import { Injectable } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { EncryptionService } from '@common/security/encryption.service';
import { TenantProvisioningService } from '@tenants/tenant-provisioning.service';

@Injectable()
export class FinanceService {
  constructor(
    private readonly tenantDb: TenantQueryRunnerService,
    private readonly encryption: EncryptionService,
    private readonly provisioning: TenantProvisioningService,
  ) {}

  async getDashboardStats(tenantId: string) {
    // 1. Get the secret to decrypt names for the "Top Customers" list
    const tenant = await this.provisioning.findById(tenantId);
    const rawSecret = this.encryption.decrypt(
      tenant.tenant_secret,
      process.env.GLOBAL_MASTER_KEY || 'secret=-key',
    );

    // 2. Perform Math in SQL (Amounts are NOT encrypted, so SQL can SUM them)
    const stats = await this.tenantDb.execute(`
      SELECT 
        SUM(amount) as total_receivable,
        SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) as cash_in_hand,
        COUNT(id) as invoice_count
      FROM invoices
    `);

    // 3. Get Aging Buckets (Requirement: AR/AP Aging)
    const aging = await this.tenantDb.execute(`
      SELECT 
        CASE 
          WHEN due_date > NOW() THEN 'current'
          WHEN due_date <= NOW() AND due_date > NOW() - INTERVAL '30 days' THEN 'overdue_30'
          ELSE 'overdue_90'
        END as bucket,
        SUM(amount) as total
      FROM invoices
      GROUP BY bucket
    `);

    // 4. Get Latest Invoices and DECRYPT them for the UI
    const latestRaw = await this.tenantDb.execute(`
      SELECT customer_name, amount, status, is_encrypted 
      FROM invoices 
      ORDER BY created_at DESC LIMIT 5
    `);

    const latestDecrypted = latestRaw.map((inv) => ({
      ...inv,
      customer_name: inv.is_encrypted
        ? this.encryption.decrypt(inv.customer_name, rawSecret)
        : inv.customer_name,
    }));

    return {
      summary: stats[0],
      aging,
      recentTransactions: latestDecrypted,
      // Placeholder for Month 2 AI anomalies
      anomalies: [],
    };
  }
}
