import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSubscriptionsTable1705000000005 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "public"."subscriptions" (
                "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                "tenant_id" UUID NOT NULL UNIQUE,
                "plan_id" UUID NOT NULL,
                "status" VARCHAR(50) NOT NULL DEFAULT 'trial',
                "current_period_start" TIMESTAMP NOT NULL DEFAULT NOW(),
                "current_period_end" TIMESTAMP NOT NULL,
                "trial_ends_at" TIMESTAMP,
                "cancelled_at" TIMESTAMP,
                "cancel_at_period_end" BOOLEAN DEFAULT FALSE,
                "last_payment_date" TIMESTAMP,
                "next_billing_date" TIMESTAMP,
                "metadata" JSONB DEFAULT '{}',
                "created_at" TIMESTAMP DEFAULT NOW(),
                "updated_at" TIMESTAMP DEFAULT NOW(),
                CONSTRAINT "fk_subscriptions_tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE,
                CONSTRAINT "fk_subscriptions_plan" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE RESTRICT,
                CONSTRAINT "check_subscription_status" CHECK (status IN ('trial', 'active', 'past_due', 'cancelled', 'expired'))
            );
        `);

    await queryRunner.query(
      `CREATE INDEX "idx_subscriptions_tenant_id" ON "public"."subscriptions"("tenant_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_subscriptions_status" ON "public"."subscriptions"("status");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "public"."subscriptions" CASCADE;`);
  }
}
