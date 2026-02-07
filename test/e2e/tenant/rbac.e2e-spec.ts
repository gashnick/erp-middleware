import { INestApplication } from '@nestjs/common';
import {
  setupTestApp,
  teardownTestApp,
  resetDatabase,
  createTenantWithUser,
} from '../../setup/test-app.bootstrap';
import { authenticatedRequest } from '../../setup/test-helpers';

describe('RBAC (Tenant Context)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  afterAll(async () => {
    await teardownTestApp();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  describe('Role-based access control', () => {
    it('should allow ADMIN to create new users', async () => {
      const tenant = await createTenantWithUser('admin@test.com', 'ADMIN');

      const newUserData = {
        email: 'newstaff@test.com',
        password: 'Password123!',
        role: 'STAFF',
        fullName: 'New Staff Member',
      };

      const response = await authenticatedRequest(app, tenant.token)
        .post('/users')
        .send(newUserData)
        .expect(201);

      expect(response.body.email).toBe(newUserData.email);
      expect(response.body.role).toBe('STAFF');
    });

    it('should prevent STAFF from creating new users', async () => {
      const adminTenant = await createTenantWithUser('admin@test.com', 'ADMIN');
      const staffTenant = await createTenantWithUser('staff@test.com', 'STAFF');

      const newUserData = {
        email: 'another@test.com',
        password: 'Password123!',
        role: 'STAFF',
        fullName: 'Another User',
      };

      await authenticatedRequest(app, staffTenant.token)
        .post('/users')
        .send(newUserData)
        .expect(403);
    });

    it('should allow ADMIN to access all tenant data', async () => {
      const tenant = await createTenantWithUser('admin@test.com', 'ADMIN');

      const response = await authenticatedRequest(app, tenant.token)
        .get('/dashboard/finance')
        .expect(200);

      expect(response.body).toHaveProperty('cashFlow');
      expect(response.body).toHaveProperty('arAging');
      expect(response.body).toHaveProperty('apAging');
    });

    it('should restrict STAFF access based on permissions', async () => {
      const tenant = await createTenantWithUser('staff@test.com', 'STAFF');

      // Staff can read their assigned data
      await authenticatedRequest(app, tenant.token).get('/invoices').expect(200);

      // But cannot export sensitive data
      await authenticatedRequest(app, tenant.token).post('/invoices/export').expect(403);
    });
  });

  describe('Tenant isolation', () => {
    it('should prevent cross-tenant data access', async () => {
      const tenant1 = await createTenantWithUser('tenant1@test.com', 'ADMIN');
      const tenant2 = await createTenantWithUser('tenant2@test.com', 'ADMIN');

      // Create data in tenant1
      await authenticatedRequest(app, tenant1.token).post('/invoices').send({
        invoice_id: 'INV-001',
        customer_name: 'Customer A',
        total_amount: 1000,
      });

      // Attempt to access tenant1's data from tenant2
      const response = await authenticatedRequest(app, tenant2.token).get('/invoices').expect(200);

      expect(response.body.data).toHaveLength(0); // Should see no invoices
    });
  });
});
