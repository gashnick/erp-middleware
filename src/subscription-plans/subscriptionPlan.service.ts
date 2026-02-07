import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class SubscriptionPlansService {
  constructor(private readonly tenantQueryRunner: TenantQueryRunnerService) {}

  async findAllPublic() {
    return this.tenantQueryRunner.executePublic(`
      SELECT id, name, slug, description,
             price_monthly, max_users,
             max_storage_gb, max_monthly_invoices,
             max_api_calls_monthly, trial_days
      FROM public.subscription_plans
      ORDER BY sort_order ASC
  `);
  }

  async findBySlug(slug: string) {
    const runner = await this.tenantQueryRunner.getPublicQueryRunner();

    try {
      const result = await runner.query(
        `
        SELECT *
        FROM public.subscription_plans
        WHERE slug = $1
        LIMIT 1
        `,
        [slug], // ✅ parameterized
      );

      return result[0] ?? null;
    } finally {
      await runner.release();
    }
  }
}
