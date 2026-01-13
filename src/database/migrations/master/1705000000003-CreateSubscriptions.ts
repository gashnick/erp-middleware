import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSubscriptions1705000000003 implements MigrationInterface {
  name = 'CreateSubscriptions1705000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create subscriptions table
    await queryRunner.query(`
      CREATE TABLE public.subscriptions (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
        plan                VARCHAR(50) NOT NULL,
        status              VARCHAR(20) NOT NULL DEFAULT 'active',
        started_at          TIMESTAMP NOT NULL DEFAULT NOW(),
        expires_at          TIMESTAMP,
        trial_ends_at       TIMESTAMP,
        auto_renew          BOOLEAN DEFAULT true,
        payment_method      JSONB,
        created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
        
        CONSTRAINT valid_subscription_plan CHECK (plan IN ('basic', 'standard', 'enterprise')),
        CONSTRAINT valid_subscription_status CHECK (status IN ('active', 'trial', 'expired', 'cancelled'))
      );
    `);

    // Create indexes for subscriptions
    await queryRunner.query(`
      CREATE INDEX idx_subscriptions_tenant ON public.subscriptions(tenant_id);
    `);

    await queryRunner.query(`
      CREATE INDEX idx_subscriptions_status ON public.subscriptions(status);
    `);

    console.log('✅ Subscriptions table created');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS public.subscriptions CASCADE;`);
    console.log('✅ Subscriptions table dropped');
  }
}
