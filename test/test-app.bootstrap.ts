// test/test-app.bootstrap.ts
import { INestApplication, ValidationPipe, Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { TenantProvisioningService } from '@tenants/tenant-provisioning.service';
import { UsersService } from '../src/users/users.service';
import { AuthService } from '../src/auth/auth.service';
import { TenantQueryRunnerService } from '../src/database/tenant-query-runner.service';
import { runWithTenantContext, UserRole } from '../src/common/context/tenant-context';
import { UserRole as CreateUserRole } from '@users/dto/create-user.dto';

/**
 * Test Application Bootstrap Utilities
 *
 * 🛡️ CRITICAL HARDENING:
 * - No silent fallbacks allowed
 * - Every test must explicitly set context
 * - Tests must fail if security checks are bypassed
 * - No assumptions about defaults
 *
 * Key Features:
 * - Deadlock-safe database cleanup between tests
 * - Proper transaction termination before TRUNCATE
 * - Retry logic for cleanup operations
 * - Resource leak prevention
 * - ENFORCED explicit context setup
 */

// Global test application instance
export let app: INestApplication | undefined;
export let tenantsService: TenantProvisioningService;
export let usersService: UsersService;
export let authService: AuthService;
export let db: TenantQueryRunnerService;

const logger = new Logger('TestBootstrap');

// System identity for test operations - using SYSTEM_JOB role
export const SYSTEM_IDENTITY = {
  tenantId: '00000000-0000-0000-0000-000000000000', // Valid UUID for system operations
  userId: 'SYSTEM_TEST_RUNNER',
  requestId: 'test-bootstrap-req',
  schemaName: 'public',
  userEmail: 'test-system@internal',
  userRole: UserRole.SYSTEM_JOB,
};

// Cache for created tenants during test runs
export const tenants: Record<string, any> = {};

// Cleanup retry configuration
const MAX_CLEANUP_RETRIES = 3;
const CLEANUP_RETRY_DELAY_MS = 100;

/**
 * Sets up the NestJS test application.
 *
 * @returns Initialized NestJS application instance
 */
export const setupTestApp = async (): Promise<INestApplication> => {
  if (app) return app;

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const createApp = moduleFixture.createNestApplication();

  // Configure global validation pipe
  createApp.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await createApp.init();
  app = createApp;

  // Extract service references
  tenantsService = moduleFixture.get<TenantProvisioningService>(TenantProvisioningService);
  usersService = moduleFixture.get<UsersService>(UsersService);
  authService = moduleFixture.get<AuthService>(AuthService);
  db = moduleFixture.get<TenantQueryRunnerService>(TenantQueryRunnerService);

  logger.log('Test application initialized successfully');

  return app;
};

/**
 * Creates a tenant with a user of specified role.
 *
 * 🛡️ CRITICAL: Explicitly sets context for test operations.
 * Tests MUST fail if context setup is incorrect.
 *
 * @param email - Email for the user (also used in tenant name)
 * @param role - User role (ADMIN, STAFF, or ANALYST)
 * @returns Tenant record with access token and user info
 * @throws Error if context cannot be established
 */
export const createTenantWithUser = async (
  email: string,
  role: 'ADMIN' | 'STAFF' | 'ANALYST' = 'ADMIN',
) => {
  return await runWithTenantContext(SYSTEM_IDENTITY, async () => {
    // Create owner user for tenant provisioning
    const ownerEmail = `owner-${Date.now()}@test.com`;
    const owner = await usersService.create(null, {
      email: ownerEmail,
      password: 'Password123!',
      role: CreateUserRole.ADMIN,
      fullName: 'Tenant Owner',
    });

    // Provision new tenant organization
    const tenantInfo = await tenantsService.createOrganization(owner.id, {
      companyName: `Test Org ${email.split('@')[0]}`,
      subscriptionPlan: 'enterprise',
      dataSourceType: 'external',
    });

    // Create additional user if role is not ADMIN
    let finalUser = owner;
    if (role !== 'ADMIN') {
      finalUser = await usersService.create(tenantInfo.tenantId, {
        email,
        password: 'Password123!',
        role: CreateUserRole[role as keyof typeof CreateUserRole],
        fullName: 'Test User',
      });
    }

    // Generate tenant-scoped JWT token
    const session = await authService.generateTenantSession(finalUser.id);

    const tenantRecord = {
      id: tenantInfo.tenantId,
      schemaName: tenantInfo.schemaName,
      token: session.access_token,
      user: await usersService.findById(finalUser.id),
    };

    // Cache tenant for potential reuse in tests
    tenants[email] = tenantRecord;

    return tenantRecord;
  });
};

/**
 * Resets database to clean state between tests.
 *
 * Critical for test isolation. Implements deadlock prevention by:
 * 1. Terminating all active backend connections
 * 2. Using retry logic for cleanup operations
 * 3. Proper transaction management
 *
 * @throws Error if cleanup fails after max retries
 */
export const resetDatabase = async (): Promise<void> => {
  if (!db) {
    logger.warn('Database service not initialized, skipping reset');
    return;
  }

  let lastError: Error | null = null;

  // Retry cleanup to handle transient deadlocks
  for (let attempt = 1; attempt <= MAX_CLEANUP_RETRIES; attempt++) {
    try {
      await resetDatabaseInternal();

      // Clear tenant cache on successful reset
      Object.keys(tenants).forEach((key) => delete tenants[key]);

      return; // Success
    } catch (error) {
      lastError = error;

      const isDeadlock =
        error?.message?.includes('deadlock') || error?.message?.includes('Connection terminated');

      if (isDeadlock && attempt < MAX_CLEANUP_RETRIES) {
        logger.warn(
          `Database reset failed (attempt ${attempt}/${MAX_CLEANUP_RETRIES}): ${error.message}. Retrying...`,
        );

        // Wait before retry with exponential backoff
        await sleep(CLEANUP_RETRY_DELAY_MS * attempt);
        continue;
      }

      // Not a deadlock or max retries reached
      logger.error(`Database reset failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  throw lastError || new Error('Database reset failed after retries');
};

/**
 * Internal database reset implementation.
 *
 * Performs actual cleanup operations with proper ordering to prevent deadlocks.
 */
async function resetDatabaseInternal(): Promise<void> {
  await runWithTenantContext(SYSTEM_IDENTITY, async () => {
    const runner = await db.getRunner();

    try {
      // CRITICAL: Terminate all other database connections first
      // This prevents deadlocks when TRUNCATE tries to acquire locks
      await terminateOtherConnections(runner);

      // Small delay to ensure connections are fully terminated
      await sleep(50);

      // Truncate public schema tables
      await truncatePublicTables(runner);

      // Restore default subscription plans
      await restoreSubscriptionPlans(runner);

      // Drop all tenant schemas
      await dropTenantSchemas(runner);
    } catch (error) {
      logger.error(`Reset database internal error: ${error.message}`);
      throw error;
    } finally {
      await runner.release();
    }
  });
}

/**
 * Terminates all other database backend processes.
 *
 * Prevents deadlocks by ensuring no other connections hold locks
 * when we try to TRUNCATE tables.
 *
 * @param runner - Database query runner
 */
async function terminateOtherConnections(runner: any): Promise<void> {
  try {
    // Get current database name
    const [dbInfo] = await runner.query(`SELECT current_database() as name`);
    const dbName = dbInfo.name;

    // Terminate all backends except our own
    // pg_terminate_backend sends SIGTERM to the backend process
    await runner.query(
      `SELECT pg_terminate_backend(pid) 
       FROM pg_stat_activity 
       WHERE datname = $1 
         AND pid <> pg_backend_pid()
         AND state IN ('idle', 'idle in transaction', 'idle in transaction (aborted)')`,
      [dbName],
    );
  } catch (error) {
    // Non-critical: Log but don't fail if termination fails
    logger.warn(`Failed to terminate other connections: ${error.message}`);
  }
}

/**
 * Truncates all public schema tables except system tables.
 *
 * @param runner - Database query runner
 */
async function truncatePublicTables(runner: any): Promise<void> {
  // Get list of tables to truncate (excluding system tables)
  const tables = await runner.query(
    `SELECT table_name 
     FROM information_schema.tables 
     WHERE table_schema = 'public' 
       AND table_type = 'BASE TABLE'
       AND table_name NOT IN ('migrations', 'subscription_plans')`,
  );

  if (tables.length === 0) {
    return; // No tables to truncate
  }

  // Build table list (properly quoted for PostgreSQL)
  const tableNames = tables.map((t: any) => `public."${t.table_name}"`).join(', ');

  // Execute TRUNCATE with CASCADE to handle foreign key constraints
  // RESTART IDENTITY resets auto-increment sequences
  await runner.query(`TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE`);
}

/**
 * Restores default subscription plan data.
 *
 * @param runner - Database query runner
 */
async function restoreSubscriptionPlans(runner: any): Promise<void> {
  await runner.query(
    `INSERT INTO "public"."subscription_plans" 
     (name, slug, description, price_monthly, max_users, max_storage_gb, 
      max_monthly_invoices, max_api_calls_monthly, trial_days)
     VALUES 
     ('Free Tier', 'free', 'Trial', 0.00, 2, 1, 10, 100, 0),
     ('Enterprise', 'enterprise', 'Large', 149.00, -1, 500, -1, 100000, 14)
     ON CONFLICT (slug) DO NOTHING`,
  );
}

/**
 * Drops all tenant-specific schemas.
 *
 * @param runner - Database query runner
 */
async function dropTenantSchemas(runner: any): Promise<void> {
  // Find all schemas matching tenant naming pattern
  const schemas = await runner.query(
    `SELECT schema_name 
     FROM information_schema.schemata 
     WHERE schema_name LIKE 'tenant_%'`,
  );

  // Drop each schema with CASCADE to remove all contained objects
  for (const schema of schemas) {
    try {
      await runner.query(`DROP SCHEMA IF EXISTS "${schema.schema_name}" CASCADE`);
    } catch (error) {
      // Log but continue if individual schema drop fails
      logger.warn(`Failed to drop schema ${schema.schema_name}: ${error.message}`);
    }
  }
}

/**
 * Tears down the test application and releases resources.
 */
export const teardownTestApp = async (): Promise<void> => {
  if (app) {
    try {
      await app.close();
      logger.log('Test application closed successfully');
    } catch (error) {
      logger.error(`Error closing test application: ${error.message}`);
    } finally {
      app = undefined;
    }
  }
};

/**
 * Sleep utility for retry delays.
 *
 * @param ms - Milliseconds to sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
