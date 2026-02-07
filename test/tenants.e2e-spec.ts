import request from 'supertest';
import {
  app,
  setupTestApp,
  teardownTestApp,
  resetDatabase,
  db,
  SYSTEM_IDENTITY,
} from './setup/test-app.bootstrap';
import { TenantMigrationRunnerService } from '../src/database/tenant-migration-runner.service';
import { runWithTenantContext } from '../src/common/context/tenant-context';

describe('Tenant Provisioning - Resilience (e2e)', () => {
  let systemToken: string;
  let migrationService: TenantMigrationRunnerService;

  beforeAll(async () => {
    await setupTestApp();
    migrationService = app!.get(TenantMigrationRunnerService);
  });

  afterAll(async () => {
    await teardownTestApp();
  });

  /**
   * Helper: Authenticate as the system admin user
   */
  const authenticateAsSystemAdmin = async (): Promise<string> => {
    const response = await request(app!.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'admin@system.com',
        password: 'Password123!',
      })
      .expect(200);

    return response.body.accessToken || response.body.access_token;
  };

  /**
   * Helper: Verify database state after rollback
   */
  const verifyCompleteRollback = async (companyName: string): Promise<void> => {
    // Small buffer for async database cleanup
    await new Promise((resolve) => setTimeout(resolve, 200));

    await runWithTenantContext(SYSTEM_IDENTITY, async () => {
      // 1. Verify user is unlinked (tenant_id back to null)
      const users = await db.execute(`SELECT tenant_id FROM public.users WHERE email = $1`, [
        'admin@system.com',
      ]);
      expect(users[0].tenant_id).toBeNull();

      // 2. Verify tenant record is deleted
      const tenants = await db.execute(`SELECT id FROM public.tenants WHERE name = $1`, [
        companyName,
      ]);
      expect(tenants).toHaveLength(0);

      // 3. Verify schema is dropped
      const slug = companyName.toLowerCase().replace(/[^a-z0-9]/g, '_');
      const schemas = await db.execute(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE $1`,
        [`tenant_${slug}%`],
      );
      expect(schemas).toHaveLength(0);
    });
  };

  describe('POST /provisioning/organizations', () => {
    let migrationSpy: jest.SpyInstance;

    beforeEach(async () => {
      await resetDatabase();
      systemToken = await authenticateAsSystemAdmin();
    });

    afterEach(() => {
      migrationSpy?.mockRestore();
    });

    it('should successfully provision and upgrade session', async () => {
      const dto = {
        companyName: 'Success Corp',
        subscriptionPlan: 'enterprise',
        dataSourceType: 'external',
      };

      const response = await request(app!.getHttpServer())
        .post('/provisioning/organizations')
        .set('Authorization', `Bearer ${systemToken}`)
        .send(dto)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.auth.accessToken).toBeDefined();
      expect(response.body.organization.name).toBe(dto.companyName);
    });

    it('should rollback completely when migrations crash', async () => {
      // Arrange: Force migration failure during Phase 2
      migrationSpy = jest
        .spyOn(migrationService, 'runMigrations')
        .mockRejectedValueOnce(new Error('MIGRATION_CRASH'));

      const dto = {
        companyName: 'Crash Corp',
        subscriptionPlan: 'enterprise',
        dataSourceType: 'external',
      };

      // Act
      const response = await request(app!.getHttpServer())
        .post('/provisioning/organizations')
        .set('Authorization', `Bearer ${systemToken}`)
        .send(dto)
        .expect(500);

      // Assert
      expect(response.body.message).toMatch(/Organization setup failed/i);
      await verifyCompleteRollback(dto.companyName);
    });

    it('should rollback when transaction fails (e.g., Schema already exists)', async () => {
      // Arrange: Manually create a schema to cause a collision in Step 4 of the transaction
      await runWithTenantContext(SYSTEM_IDENTITY, async () => {
        await db.execute(`CREATE SCHEMA "tenant_collision_corp"`);
      });

      const dto = {
        companyName: 'Collision Corp', // slug will be collision_corp
        subscriptionPlan: 'free',
        dataSourceType: 'internal',
      };

      // Act
      await request(app!.getHttpServer())
        .post('/provisioning/organizations')
        .set('Authorization', `Bearer ${systemToken}`)
        .send(dto)
        .expect(500);

      // Assert: Verify cleanup of the tenant record and user link
      await verifyCompleteRollback(dto.companyName);
    });
  });
});
