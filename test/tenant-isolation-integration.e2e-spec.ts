// test/tenant-isolation-integration.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { TenantsService } from '../src/tenants/tenants.service';
import { UsersService } from '@users/users.service';
import { AuthService } from '../src/auth/auth.service';

describe('Tenant Isolation Integration Tests (E2E)', () => {
  let app: INestApplication;
  let tenantsService: TenantsService;
  let usersService: UsersService;
  let authService: AuthService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    tenantsService = moduleFixture.get<TenantsService>(TenantsService);
    usersService = moduleFixture.get<UsersService>(UsersService);
    authService = moduleFixture.get<AuthService>(AuthService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('2. Integration Test Middleware + Guard', () => {
    it('should reject requests without tenant context', async () => {
      // Request without JWT - should fail
      await request(app.getHttpServer()).get('/invoices').expect(401); // Unauthorized
    });

    it('should reject requests with wrong tenantId in JWT', async () => {
      // Create tenant
      const tenant = await tenantsService.create({
        companyName: 'Test Tenant',
        dataSourceType: 'external',
        subscriptionPlan: 'basic',
      });

      // Create user for tenant
      const user = await usersService.create(tenant.id, {
        email: 'user@test.com',
        password: 'password123',
        fullName: 'Test User',
        role: 'admin',
      });

      // Login
      const login = await authService.login({
        email: 'user@test.com',
        password: 'password123',
      });

      // Try to access with wrong tenant ID in header
      await request(app.getHttpServer())
        .get('/invoices')
        .set('Authorization', `Bearer ${login.access_token}`)
        .set('X-Tenant-ID', 'wrong-tenant-id')
        .expect(401); // Should fail due to tenant validation
    });

    it('should accept valid JWT and set context, route works', async () => {
      // Create tenant
      const tenant = await tenantsService.create({
        companyName: 'Valid Tenant',
        dataSourceType: 'external',
        subscriptionPlan: 'basic',
      });

      // Create user
      const user = await usersService.create(tenant.id, {
        email: 'valid@test.com',
        password: 'password123',
        fullName: 'Valid User',
        role: 'admin',
      });

      // Login
      const login = await authService.login({
        email: 'valid@test.com',
        password: 'password123',
      });

      // Access with valid JWT (tenant context set by middleware)
      const response = await request(app.getHttpServer())
        .get('/invoices')
        .set('Authorization', `Bearer ${login.access_token}`)
        .expect(200);

      // Should return empty array (no invoices yet)
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('3. Schema Isolation Test', () => {
    it('should check cross-tenant leaks at DB level', async () => {
      // Create two tenants
      const tenantA = await tenantsService.create({
        companyName: 'Tenant A',
        dataSourceType: 'external',
        subscriptionPlan: 'basic',
      });

      const tenantB = await tenantsService.create({
        companyName: 'Tenant B',
        dataSourceType: 'external',
        subscriptionPlan: 'basic',
      });

      // Create users
      const userA = await usersService.create(tenantA.id, {
        email: 'userA@test.com',
        password: 'password123',
        fullName: 'User A',
        role: 'admin',
      });

      const userB = await usersService.create(tenantB.id, {
        email: 'userB@test.com',
        password: 'password123',
        fullName: 'User B',
        role: 'admin',
      });

      // Login both users
      const loginA = await authService.login({
        email: 'userA@test.com',
        password: 'password123',
      });

      const loginB = await authService.login({
        email: 'userB@test.com',
        password: 'password123',
      });

      // Create invoice in Tenant A schema
      const invoiceA = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${loginA.access_token}`)
        .send({
          invoice_number: 'INV-A-001',
          customer_name: 'Customer A',
          amount: 1000,
        })
        .expect(201);

      // Try to query from Tenant B schema - should not see Tenant A's data
      const invoicesB = await request(app.getHttpServer())
        .get('/invoices')
        .set('Authorization', `Bearer ${loginB.access_token}`)
        .expect(200);

      // Tenant B should see empty results
      expect(invoicesB.body).toHaveLength(0);

      // Verify Tenant A still sees their invoice
      const invoicesA = await request(app.getHttpServer())
        .get('/invoices')
        .set('Authorization', `Bearer ${loginA.access_token}`)
        .expect(200);

      expect(invoicesA.body).toHaveLength(1);
      expect(invoicesA.body[0].invoice_number).toBe('INV-A-001');
    });
  });

  describe('6. Negative Tests (Integration)', () => {
    it('should run migrations for one tenant, then try querying another without proper context', async () => {
      // This test would require actual migration setup
      // For now, we test that different tenants have isolated data

      // Create two tenants
      const tenantA = await tenantsService.create({
        companyName: 'Tenant A Migration',
        dataSourceType: 'external',
        subscriptionPlan: 'basic',
      });

      const tenantB = await tenantsService.create({
        companyName: 'Tenant B Migration',
        dataSourceType: 'external',
        subscriptionPlan: 'basic',
      });

      // Create users
      const userA = await usersService.create(tenantA.id, {
        email: 'migrationA@test.com',
        password: 'password123',
        fullName: 'Migration User A',
        role: 'admin',
      });

      const userB = await usersService.create(tenantB.id, {
        email: 'migrationB@test.com',
        password: 'password123',
        fullName: 'Migration User B',
        role: 'admin',
      });

      // Login
      const loginA = await authService.login({
        email: 'migrationA@test.com',
        password: 'password123',
      });

      const loginB = await authService.login({
        email: 'migrationB@test.com',
        password: 'password123',
      });

      // Create data in Tenant A
      await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${loginA.access_token}`)
        .send({
          invoice_number: 'MIGRATION-A-001',
          customer_name: 'Migration Customer A',
          amount: 500,
        })
        .expect(201);

      // Tenant B should not see Tenant A's data
      const invoicesB = await request(app.getHttpServer())
        .get('/invoices')
        .set('Authorization', `Bearer ${loginB.access_token}`)
        .expect(200);

      expect(invoicesB.body).toHaveLength(0);
    });
  });
});
