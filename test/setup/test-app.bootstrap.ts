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

  // Ensure a clean database state before any E2E tests run
  // This uses the same reset helper the tests call in beforeEach so the
  // environment is deterministic even if previous runs left artifacts.
  await resetDatabase();

  return app;
};

export const teardownTestApp = async (): Promise<void> => {
  if (app) {
    await app.close();
    app = undefined;
  }
};

/**
 * Cleanly resets the DB using getRunner() to bypass
 * standard tenant transaction constraints for administrative drops.
 */
export const resetDatabase = async (): Promise<void> => {
  if (!db) return;

  for (let attempt = 1; attempt <= MAX_CLEANUP_RETRIES; attempt++) {
    const runner = await db.getRunner(); // Using the new helper method
    try {
      await runner.startTransaction();

      // 1. Connection Cleanup
      await terminateOtherConnections(runner);

      // 2. Schema Cleanup
      const schemas = await runner.query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'tenant_%'`,
      );

      for (const s of schemas) {
        await runner.query(`DROP SCHEMA IF EXISTS "${s.schema_name}" CASCADE`);
      }

      // 3. Public Table Cleanup
      const tables = await runner.query(
        `SELECT table_name FROM information_schema.tables 
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
         AND table_name NOT IN ('migrations', 'subscription_plans')`,
      );

      if (tables.length > 0) {
        const tableList = tables.map((t: any) => `public."${t.table_name}"`).join(', ');
        // Log table list for debugging cleanup issues
        // eslint-disable-next-line no-console
        // console.log('[resetDatabase] truncating tables:', tableList);

        // Log count of users before truncation to detect leakage
        try {
          const before = await runner.query(`SELECT COUNT(*)::int as cnt FROM public.users`);
          // eslint-disable-next-line no-console
          console.log('[resetDatabase] public.users count before:', before[0]?.cnt ?? 0);
        } catch (e) {
          // ignore if table doesn't exist yet
        }

        await runner.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);

        try {
          const after = await runner.query(`SELECT COUNT(*)::int as cnt FROM public.users`);
          // eslint-disable-next-line no-console
          //console.log('[resetDatabase] public.users count after:', after[0]?.cnt ?? 0);
        } catch (e) {
          // ignore
        }
      }

      // 4. Restore Seeds
      // Acquire an advisory lock so parallel test workers don't race when
      // inserting seed rows (which can cause unique constraint violations).
      // Use a fixed key for all test processes.
      const SEED_LOCK_KEY = 987654321;
      await runner.query('SELECT pg_advisory_lock($1)', [SEED_LOCK_KEY]);
      try {
        await restoreSubscriptionPlans(runner);
        await restoreUsers(runner);
      } finally {
        // best-effort unlock; safe even if lock wasn't held
        await runner.query('SELECT pg_advisory_unlock($1)', [SEED_LOCK_KEY]);
      }

      // Commit only if transaction is active
      if (runner.isTransactionActive) {
        await runner.commitTransaction();
      } else {
        // eslint-disable-next-line no-console
        //console.warn('[resetDatabase] no active transaction to commit');
      }
      Object.keys(tenants).forEach((key) => delete tenants[key]);
      return;
    } catch (error) {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();
      } else {
        // eslint-disable-next-line no-console
        //console.warn('[resetDatabase] no active transaction to rollback');
      }
      if (attempt === MAX_CLEANUP_RETRIES) throw error;
      await new Promise((res) => setTimeout(res, CLEANUP_RETRY_DELAY_MS * attempt));
    } finally {
      // Ensure any advisory lock is released (best-effort) before releasing the runner.
      try {
        await runner.query('SELECT pg_advisory_unlock($1)', [987654321]);
      } catch (e) {
        // ignore
      }
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
  await runner.query(`DELETE FROM public.subscription_plans`);
  await runner.query(
    `INSERT INTO public.subscription_plans 
      (name, slug, description, price_monthly, max_users, max_storage_gb, max_monthly_invoices, max_api_calls_monthly, trial_days, sort_order)
     VALUES 
      ('Free Tier', 'free', 'Trial period', 0.0, 2, 1, 10, 100, 0, 0),
      ('Enterprise', 'enterprise', 'Large organizations', 149.0, -1, 500, -1, 100000, 14, 3)`,
  );
}

async function restoreUsers(runner: QueryRunner): Promise<void> {
  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash('Password123!', salt);

  // Defensive: check existing admin user first to avoid unique key races
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
) => {
  return await runWithTenantContext(SYSTEM_IDENTITY, async () => {
    // We use standard services here because they utilize db.transaction internally
    const owner = await usersService.create(null, {
      email: `owner-${Date.now()}@test.com`,
      password: 'Password123!',
      role: CreateUserRole.ADMIN,
      fullName: 'Org Owner',
    });

    const tenantInfo = await tenantsService.createOrganization(owner.id, {
      companyName: `TestOrg-${email}`,
      subscriptionPlan: 'enterprise',
      dataSourceType: 'external',
    });

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
