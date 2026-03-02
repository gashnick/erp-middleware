import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../../src/app.module';
import { TenantProvisioningService } from '@tenants/tenant-provisioning.service';
import { UsersService } from '../../src/users/users.service';
import { AuthService } from '../../src/auth/auth.service';
import { TenantQueryRunnerService } from '../../src/database/tenant-query-runner.service';
import { runWithTenantContext, UserRole } from '../../src/common/context/tenant-context';
import { UserRole as CreateUserRole } from '@users/dto/create-user.dto';
import { QueryRunner } from 'typeorm';

const MAX_CLEANUP_RETRIES = 3;
const CLEANUP_RETRY_DELAY_MS = 150;

export const SYSTEM_IDENTITY = {
  tenantId: '00000000-0000-0000-0000-000000000000',
  userId: 'SYSTEM_TEST_RUNNER',
  requestId: 'test-bootstrap-req',
  schemaName: 'public',
  userEmail: 'test-system@internal',
  userRole: UserRole.SYSTEM_JOB,
};

export let app: INestApplication | undefined;
export let tenantsService: TenantProvisioningService;
export let usersService: UsersService;
export let authService: AuthService;
export let db: TenantQueryRunnerService;
export const tenants: Record<string, any> = {};

export const setupTestApp = async (): Promise<INestApplication> => {
  if (app) return app;

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleFixture.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );

  await app.init();

  tenantsService = moduleFixture.get<TenantProvisioningService>(TenantProvisioningService);
  usersService = moduleFixture.get<UsersService>(UsersService);
  authService = moduleFixture.get<AuthService>(AuthService);
  db = moduleFixture.get<TenantQueryRunnerService>(TenantQueryRunnerService);

  await resetDatabase();

  return app;
};

export const teardownTestApp = async (): Promise<void> => {
  if (app) {
    await app.close();
    app = undefined;
  }
};

export const resetDatabase = async (): Promise<void> => {
  if (!db) return;

  for (let attempt = 1; attempt <= MAX_CLEANUP_RETRIES; attempt++) {
    const runner = await db.getRunner();
    try {
      await runner.startTransaction();
      await terminateOtherConnections(runner);

      const schemas = await runner.query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'tenant_%'`,
      );

      for (const s of schemas) {
        await runner.query(`DROP SCHEMA IF EXISTS "${s.schema_name}" CASCADE`);
      }

      // Updated exclusion: Do not truncate subscription_plans (seed data)
      const tables = await runner.query(
        `SELECT table_name FROM information_schema.tables 
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
         AND table_name NOT IN ('migrations', 'subscription_plans')`,
      );

      if (tables.length > 0) {
        const tableList = tables.map((t: any) => `public."${t.table_name}"`).join(', ');
        await runner.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
      }

      const SEED_LOCK_KEY = 987654321;
      await runner.query('SELECT pg_advisory_lock($1)', [SEED_LOCK_KEY]);
      try {
        await restoreSubscriptionPlans(runner);
        await restoreUsers(runner);
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1)', [SEED_LOCK_KEY]);
      }

      if (runner.isTransactionActive) {
        await runner.commitTransaction();
      }
      Object.keys(tenants).forEach((key) => delete tenants[key]);
      return;
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      if (attempt === MAX_CLEANUP_RETRIES) throw error;
      await new Promise((res) => setTimeout(res, CLEANUP_RETRY_DELAY_MS * attempt));
    } finally {
      try {
        await runner.query('SELECT pg_advisory_unlock($1)', [987654321]);
      } catch (e) {}
      await runner.release();
    }
  }
};

async function terminateOtherConnections(runner: QueryRunner): Promise<void> {
  const [dbInfo] = await runner.query(`SELECT current_database() as name`);
  await runner.query(
    `SELECT pg_terminate_backend(pid) 
     FROM pg_stat_activity 
     WHERE datname = $1 AND pid <> pg_backend_pid() 
     AND state IN ('idle', 'idle in transaction')`,
    [dbInfo.name],
  );
}

async function restoreSubscriptionPlans(runner: QueryRunner): Promise<void> {
  // Clear and re-seed to ensure deterministic IDs and limits
  await runner.query(`DELETE FROM public.subscription_plans`);
  await runner.query(
    `INSERT INTO public.subscription_plans 
      (name, slug, description, price_monthly, max_users, max_storage_gb, max_monthly_invoices, max_api_calls_monthly, trial_days, sort_order)
     VALUES 
      ('Free Tier', 'free', 'Trial period', 0.00, 2, 1, 10, 100, 0, 0),
      ('Basic', 'basic', 'Small teams', 19.00, 3, 5, 50, 1000, 14, 1),
      ('Standard', 'standard', 'Growing businesses', 49.00, 10, 50, 500, 10000, 14, 2),
      ('Enterprise', 'enterprise', 'Large organizations', 149.00, -1, 500, -1, 100000, 14, 3)`,
  );
}

async function restoreUsers(runner: QueryRunner): Promise<void> {
  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash('Password123!', salt);

  const existing = await runner.query(
    `SELECT id FROM public.users WHERE email = $1 AND tenant_id IS NULL LIMIT 1`,
    ['admin@system.com'],
  );
  if (!existing || existing.length === 0) {
    await runner.query(
      `INSERT INTO public.users (email, password_hash, role, full_name)
       VALUES ($1, $2, $3, $4)`,
      ['admin@system.com', hash, 'ADMIN', 'System Admin'],
    );
  }
}

export const createTenantWithUser = async (
  email: string,
  role: 'ADMIN' | 'STAFF' | 'ANALYST' = 'ADMIN',
  planSlug: string = 'enterprise', // Defaulting to enterprise for tests
) => {
  return await runWithTenantContext(SYSTEM_IDENTITY, async () => {
    const owner = await usersService.create(null, {
      email: `owner-${Date.now()}@test.com`,
      password: 'Password123!',
      role: CreateUserRole.ADMIN,
      fullName: 'Org Owner',
    });

    const tenantInfo = await tenantsService.createOrganization(owner.id, {
      companyName: `TestOrg-${email}`,
      subscriptionPlan: planSlug,
      dataSourceType: 'external',
    });

    // --- FIX: Create the Subscription Record for the Rate Limiter to find ---
    const runner = await db.getRunner();
    try {
      const plans = await runner.query(`SELECT id FROM public.subscription_plans WHERE slug = $1`, [
        planSlug,
      ]);
      const planId = plans[0]?.id;

      if (planId) {
        await runner.query(
          `INSERT INTO public.subscriptions 
           (tenant_id, plan_id, status, current_period_end)
           VALUES ($1, $2, 'active', NOW() + INTERVAL '30 days')
           ON CONFLICT (tenant_id) DO UPDATE SET plan_id = EXCLUDED.plan_id`,
          [tenantInfo.tenantId, planId],
        );
      }
    } finally {
      await runner.release();
    }
    // -----------------------------------------------------------------------

    let targetUser = owner;
    if (role !== 'ADMIN') {
      targetUser = await usersService.create(tenantInfo.tenantId, {
        email,
        password: 'Password123!',
        role: CreateUserRole[role],
        fullName: 'Staff User',
      });
    }

    const session = await authService.generateTenantSession(targetUser.id);
    return {
      id: tenantInfo.tenantId,
      token: session.access_token,
      user: targetUser,
      schemaName: tenantInfo.schemaName,
    };
  });
};
